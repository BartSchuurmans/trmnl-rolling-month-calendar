<?php
// Publishes LaraPaper's devices to Home Assistant through MQTT discovery (LaraPaper
// (local) app). Runs as the s6 service larapaper-local-mqtt, as www-data, and keeps
// running: s6 starts it again when it exits (broker gone, no broker yet).
//
// Every TRMNL in LaraPaper becomes a Home Assistant device, keyed by its MAC address,
// with battery, charging, Wi-Fi signal, firmware, last seen, an online sensor and whatever
// attached sensors it reports. Everything comes from what LaraPaper stores when the
// device asks for its screen (UpdateDeviceTelemetry); this script only reads it, through
// LaraPaper's own models, without changing LaraPaper. Nothing runs inside the device's
// request, so a slow or missing broker never slows the TRMNL down.
//
// Every INTERVAL seconds it builds each device's discovery config and state and
// publishes those that changed (retained). Devices deleted in LaraPaper are removed
// from Home Assistant with an empty config: it subscribes to the discovery topics, so
// the broker's retained configs tell it which devices it published before.
//
// The broker comes from the Supervisor (services: mqtt:want in config.yaml), or from
// MQTT_HOST, MQTT_PORT, MQTT_USERNAME, MQTT_PASSWORD (the end-to-end test).
//
//   php mqtt.php           publish until stopped
//   php mqtt.php --once    publish once, wait for the broker to take it, exit

use App\Models\Device;
use App\Models\Firmware;
use App\Services\DeviceSensorService;
use Illuminate\Support\Facades\DB;

$root = getenv('LARAPAPER_DIR') ?: '/var/www/html';
require "$root/vendor/autoload.php";
$app = require "$root/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
DB::disableQueryLog();

const ORIGIN = ['name' => 'LaraPaper (local)', 'url' => 'https://github.com/BartSchuurmans/trmnl-rolling-month-calendar'];
// A device that hasn't asked for a screen in twice its refresh interval plus this long
// is offline
const OFFLINE_GRACE_SECONDS = 300;

$interval = max(1, (int) (getenv('LARAPAPER_LOCAL_MQTT_INTERVAL') ?: 10));
$prefix = getenv('MQTT_DISCOVERY_PREFIX') ?: 'homeassistant';
// Tells this LaraPaper's devices apart from another's on the same broker; the app key
// is created once per install (/data/app_key)
$instance = substr(hash('sha256', (string) config('app.key')), 0, 8);
$base = "larapaper/$instance";
$once = in_array('--once', $argv, true);

function say(string $message): void
{
    echo "[larapaper-local] mqtt: $message\n";
}

/** @return array{host: string, port: int, ssl: bool, username: ?string, password: ?string}|null */
function broker(): ?array
{
    if ($host = getenv('MQTT_HOST')) {
        return ['host' => $host, 'port' => (int) (getenv('MQTT_PORT') ?: 1883), 'ssl' => false,
            'username' => getenv('MQTT_USERNAME') ?: null, 'password' => getenv('MQTT_PASSWORD') ?: null];
    }
    $token = getenv('SUPERVISOR_TOKEN');
    if (! $token) {
        return null;
    }
    // {"result": "ok", "data": {"host", "port", "ssl", "username", "password", ...}};
    // an error when no MQTT app (Mosquitto) provides the service
    $context = stream_context_create(['http' => [
        'header' => "Authorization: Bearer $token", 'timeout' => 10, 'ignore_errors' => true]]);
    $response = json_decode((string) @file_get_contents('http://supervisor/services/mqtt', false, $context), true);
    $data = $response['data'] ?? null;
    if (($response['result'] ?? null) !== 'ok' || empty($data['host'])) {
        return null;
    }

    return ['host' => $data['host'], 'port' => (int) ($data['port'] ?? 1883), 'ssl' => (bool) ($data['ssl'] ?? false),
        'username' => $data['username'] ?? null, 'password' => $data['password'] ?? null];
}

// Just enough MQTT 3.1.1 for this: QoS 0 publish and subscribe, a last will, keepalive
final class Mqtt
{
    private const KEEPALIVE = 60;

    /** @var resource */
    private $socket;

    private string $buffer = '';

    private float $lastSent;

    /** @param callable(string, string): void $onMessage */
    public function __construct(array $broker, string $clientId, string $willTopic, string $willPayload,
        private $onMessage)
    {
        $url = ($broker['ssl'] ? 'tls' : 'tcp')."://{$broker['host']}:{$broker['port']}";
        $socket = @stream_socket_client($url, $errno, $error, 10);
        if ($socket === false) {
            throw new RuntimeException("can't connect to $url: $error");
        }
        $this->socket = $socket;

        $flags = 0x02 | 0x04 | 0x20; // clean session, will, will retained
        $payload = self::str($clientId).self::str($willTopic).self::str($willPayload);
        if ($broker['username'] !== null) {
            $flags |= 0x80;
            $payload .= self::str($broker['username']);
            if ($broker['password'] !== null) {
                $flags |= 0x40;
                $payload .= self::str($broker['password']);
            }
        }
        $this->send(0x10, self::str('MQTT').chr(4).chr($flags).pack('n', self::KEEPALIVE).$payload);

        [$type, $body] = $this->read(10) ?? throw new RuntimeException('no CONNACK from the broker');
        if ($type !== 0x20 || ($body[1] ?? "\x05") !== "\x00") {
            throw new RuntimeException('broker refused the connection (CONNACK '.bin2hex($body).')');
        }
    }

    public function publish(string $topic, string $payload, bool $retain = true): void
    {
        $this->send(0x30 | ($retain ? 0x01 : 0), self::str($topic).$payload);
    }

    public function subscribe(string ...$filters): void
    {
        $body = pack('n', 1);
        foreach ($filters as $filter) {
            $body .= self::str($filter).chr(0);
        }
        $this->send(0x82, $body);
    }

    // Handles what the broker sends for up to $seconds; pings when idle
    public function loop(float $seconds): void
    {
        $until = microtime(true) + $seconds;
        while (($left = $until - microtime(true)) > 0) {
            if (microtime(true) - $this->lastSent > self::KEEPALIVE / 2) {
                $this->send(0xC0, '');
            }
            $packet = $this->read(min($left, self::KEEPALIVE / 2));
            if ($packet !== null && $packet[0] === 0x30) {
                $body = $packet[1];
                $length = unpack('n', $body)[1];
                ($this->onMessage)(substr($body, 2, $length), (string) substr($body, 2 + $length));
            }
        }
    }

    public function disconnect(): void
    {
        $this->send(0xE0, '');
        fclose($this->socket);
    }

    private static function str(string $value): string
    {
        return pack('n', strlen($value)).$value;
    }

    private function send(int $header, string $body): void
    {
        $length = strlen($body);
        $encoded = '';
        do {
            $byte = $length % 128;
            $length = intdiv($length, 128);
            $encoded .= chr($length > 0 ? $byte | 0x80 : $byte);
        } while ($length > 0);
        $packet = chr($header).$encoded.$body;
        for ($written = 0; $written < strlen($packet); $written += $n) {
            $n = @fwrite($this->socket, substr($packet, $written));
            if ($n === false || $n === 0) {
                throw new RuntimeException('lost the connection to the broker');
            }
        }
        $this->lastSent = microtime(true);
    }

    // One packet as [type (high nibble, flags masked off except for PUBLISH's 0x30), body],
    // or null if none arrives within $timeout seconds
    private function read(float $timeout): ?array
    {
        $until = microtime(true) + $timeout;
        while (true) {
            if (($packet = $this->parse()) !== null) {
                return $packet;
            }
            $left = $until - microtime(true);
            if ($left <= 0) {
                return null;
            }
            $read = [$this->socket];
            $none = null;
            if (@stream_select($read, $none, $none, (int) $left, (int) (fmod($left, 1) * 1e6)) === false) {
                throw new RuntimeException('lost the connection to the broker');
            }
            if ($read) {
                $chunk = fread($this->socket, 65536);
                if ($chunk === '' || $chunk === false) {
                    throw new RuntimeException('the broker closed the connection');
                }
                $this->buffer .= $chunk;
            }
        }
    }

    private function parse(): ?array
    {
        $length = 0;
        $multiplier = 1;
        for ($i = 1; ; $i++) {
            if (! isset($this->buffer[$i])) {
                return null;
            }
            $byte = ord($this->buffer[$i]);
            $length += ($byte & 0x7F) * $multiplier;
            $multiplier *= 128;
            if (($byte & 0x80) === 0) {
                break;
            }
        }
        if (strlen($this->buffer) < $i + 1 + $length) {
            return null;
        }
        $type = ord($this->buffer[0]) & 0xF0;
        $body = substr($this->buffer, $i + 1, $length);
        $this->buffer = substr($this->buffer, $i + 1 + $length);

        return [$type, $body];
    }
}

// Home Assistant's unit for what a sensor reports (DeviceSensorKind), where it differs
function sensorUnit(string $unit): string
{
    return match (strtolower($unit)) {
        'c', 'celsius', 'degc' => '°C',
        'f', 'fahrenheit', 'degf' => '°F',
        'pct', 'percent' => '%',
        default => $unit,
    };
}

// [device id => [discovery config, state]] for every device with a MAC address
function snapshot(string $prefix, string $base, string $instance): array
{
    $sensors = app(DeviceSensorService::class);
    // The device's page in LaraPaper, if the App URL option is set (not LaraPaper's default)
    $appUrl = rtrim((string) config('app.url'), '/');
    $appUrl = preg_match('#^https?://#', $appUrl) && ! in_array(parse_url($appUrl, PHP_URL_HOST), ['localhost', '127.0.0.1'], true)
        ? $appUrl : null;
    $result = [];
    foreach (Device::query()->with('deviceModel')->get() as $device) {
        $mac = strtolower((string) $device->mac_address);
        if (! preg_match('/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/', $mac)) {
            continue;
        }
        $id = "larapaper_{$instance}_".str_replace(':', '', $mac);
        $stateTopic = "$base/".str_replace(':', '', $mac).'/state';

        $lastSeen = $device->last_refreshed_at;
        $interval = max(60, (int) $device->default_refresh_interval);
        $online = $lastSeen !== null && ($lastSeen->getTimestamp() + 2 * $interval + OFFLINE_GRACE_SECONDS >= time()
            || $device->isSleepModeActive() || $device->isPauseActive());
        $firmware = $device->last_firmware_version;
        // The newest firmware LaraPaper knows of for this model (FirmwarePollJob), if any
        $latest = Firmware::query()->where('latest', true)
            ->where('model', $device->usesTouchBar() ? 'trmnl_x' : 'trmnl')
            ->value('version_tag');
        $bool = fn (?bool $value) => $value === null ? null : ($value ? 'ON' : 'OFF');

        $state = [
            'battery' => $device->last_battery_voltage === null ? null : round($device->battery_percent),
            'battery_voltage' => $device->last_battery_voltage,
            'charging' => $bool($device->last_battery_charging),
            'usb' => $bool($device->last_usb_connected),
            'online' => $bool($online),
            'last_seen' => $lastSeen?->toIso8601String(),
            'rssi' => $device->last_rssi_level,
            'refresh_interval' => $device->default_refresh_interval,
            'firmware' => $firmware,
            'latest_firmware' => $latest ?? $firmware,
        ];

        $sensor = fn (string $name, array $extra) => ['p' => 'sensor', 'name' => $name, 'state_class' => 'measurement'] + $extra;
        $diagnostic = ['entity_category' => 'diagnostic'];
        $components = [
            'battery' => $sensor('Battery', ['device_class' => 'battery', 'unit_of_measurement' => '%']),
            'charging' => ['p' => 'binary_sensor', 'name' => 'Charging', 'device_class' => 'battery_charging'],
            'usb' => ['p' => 'binary_sensor', 'name' => 'USB connected', 'device_class' => 'plug'],
            'online' => ['p' => 'binary_sensor', 'name' => 'Online', 'device_class' => 'connectivity'] + $diagnostic,
            'last_seen' => ['p' => 'sensor', 'name' => 'Last seen', 'device_class' => 'timestamp'] + $diagnostic,
            'rssi' => $sensor('Wi-Fi signal', ['device_class' => 'signal_strength', 'unit_of_measurement' => 'dBm'] + $diagnostic),
            'battery_voltage' => $sensor('Battery voltage', ['device_class' => 'voltage', 'unit_of_measurement' => 'V',
                'suggested_display_precision' => 2, 'enabled_by_default' => false] + $diagnostic),
            'refresh_interval' => ['p' => 'sensor', 'name' => 'Refresh interval', 'device_class' => 'duration',
                'unit_of_measurement' => 's', 'enabled_by_default' => false] + $diagnostic,
        ];
        // Once the device has said which firmware it runs (Home Assistant rejects an
        // update without an installed version)
        if ($firmware !== null) {
            $components['firmware'] = ['p' => 'update', 'name' => 'Firmware', 'device_class' => 'firmware',
                'value_template' => "{{ {'installed_version': value_json.firmware, 'latest_version': value_json.latest_firmware} | tojson }}"];
        }
        // Attached sensors (temperature, humidity, ...): the latest reading of each kind
        // the device has reported
        foreach ($sensors->latestPerKind($device) as $kind => $reading) {
            $state[$kind] = $reading['value'];
            $components[$kind] = $sensor(ucfirst(str_replace('_', ' ', $kind === 'carbon_dioxide' ? 'CO2' : $kind)),
                ['device_class' => $kind, 'unit_of_measurement' => sensorUnit($reading['unit'])]);
        }
        foreach ($components as $key => &$component) {
            $component['unique_id'] = "{$id}_$key";
            $component['value_template'] ??= "{{ value_json.$key }}";
        }
        unset($component);

        $config = [
            'dev' => array_filter([
                'ids' => [$id],
                'cns' => [['mac', $mac]],
                'name' => $device->name ?: $device->friendly_id ?: 'TRMNL',
                'mf' => 'TRMNL',
                'mdl' => $device->deviceModel?->label,
                'sw' => $firmware,
                'cu' => $appUrl ? "$appUrl/devices/{$device->id}/configure" : null,
            ], fn ($value) => $value !== null),
            'o' => ORIGIN,
            'cmps' => $components,
            'stat_t' => $stateTopic,
            'avty_t' => "$base/status",
        ];
        $result[$id] = ['config' => $config, 'state' => $state, 'state_topic' => $stateTopic];
    }

    return $result;
}

// Discovery configs of this LaraPaper on the broker: [device id => state topic]
$onBroker = [];
// What was last published: [device id => [config JSON, state JSON]]
$published = [];
$haRestarted = false;

$broker = broker();
if ($broker === null) {
    say('no MQTT broker: install the Mosquitto broker app (or set MQTT_HOST) for device sensors in Home Assistant');
    exit(3);
}

$client = new Mqtt($broker, "larapaper-local-$instance", "$base/status", 'offline',
    function (string $topic, string $payload) use ($prefix, $instance, &$onBroker, &$haRestarted): void {
        if ($topic === "$prefix/status") {
            $haRestarted = $payload === 'online';
        } elseif (preg_match('#^'.preg_quote($prefix, '#')."/device/(larapaper_{$instance}_[0-9a-f]{12})/config$#", $topic, $m)) {
            if ($payload === '') {
                unset($onBroker[$m[1]]);
            } else {
                $onBroker[$m[1]] = json_decode($payload, true)['stat_t'] ?? null;
            }
        }
    });
say("connected to {$broker['host']}:{$broker['port']} (instance $instance)");
$client->publish("$base/status", 'online');
$client->subscribe("$prefix/status", "$prefix/device/+/config");
// The broker sends the retained discovery configs right after subscribing
$client->loop(1);

while (true) {
    if ($haRestarted) {
        // Home Assistant came back: it reads the retained messages again by itself, but
        // send everything once more in case its broker lost them
        say('Home Assistant restarted, publishing again');
        $published = [];
        $haRestarted = false;
    }
    $devices = snapshot($prefix, $base, $instance);
    foreach ($devices as $id => $device) {
        $config = json_encode($device['config'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $state = json_encode($device['state'], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (($published[$id][0] ?? null) !== $config) {
            $client->publish("$prefix/device/$id/config", $config);
            if (! isset($published[$id])) {
                say("published {$device['config']['dev']['name']} ($id)");
            }
        }
        if (($published[$id][1] ?? null) !== $state) {
            $client->publish($device['state_topic'], $state);
        }
        $published[$id] = [$config, $state];
    }
    foreach (array_diff_key($onBroker + $published, $devices) as $id => $stateTopic) {
        say("removed $id (no longer in LaraPaper)");
        $client->publish("$prefix/device/$id/config", '');
        if (is_string($stateTopic)) {
            $client->publish($stateTopic, '');
        }
        unset($onBroker[$id], $published[$id]);
    }
    if ($once) {
        $client->loop(1);
        $client->disconnect();
        exit(0);
    }
    $client->loop($interval);
}
