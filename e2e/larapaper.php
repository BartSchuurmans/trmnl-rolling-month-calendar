<?php
// Runs inside the LaraPaper container (as www-data; LARAPAPER_DIR defaults to /var/www/html) for the
// end-to-end test. Does what a user would do in the web UI, through LaraPaper's own
// services, and reports what LaraPaper stored. Prints JSON.
//
//   php larapaper.php setup <recipe.zip> <ha_url> <ha_token>
//       user, recipe import, TRMNL X device with a playlist showing the recipe
//   php larapaper.php configure '<json custom field values>'
//       merges into the recipe configuration and drops cached data and image
//   php larapaper.php check
//       polled payload summary, cached images, and the screen's size and grey levels
//   php larapaper.php login
//       a new password for the user (after setup), to log in to the web UI
//   php larapaper.php device add|delete
//       a second device (no playlist), for the device sensors in Home Assistant
//   php larapaper.php prerender
//       LaraPaper's Lab pre-render (PrerenderUpcomingPlaylistItemsJob), once, as if the
//       device were due in 90 s; lists the render jobs it queued for the queue worker

use App\Jobs\PrerenderUpcomingPlaylistItemsJob;
use App\Models\Device;
use App\Models\DeviceModel;
use App\Models\Playlist;
use App\Models\PlaylistItem;
use App\Models\Plugin;
use App\Models\User;
use App\Services\PluginImportService;
use Illuminate\Http\UploadedFile;
use Illuminate\Queue\Events\JobQueued;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\Facades\Storage;
use OffloadProject\Toggle\Facades\Toggle;
use OffloadProject\Toggle\ToggleManager;

$root = getenv('LARAPAPER_DIR') ?: '/var/www/html';
require "$root/vendor/autoload.php";
$app = require "$root/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

const TRMNLP_ID = 'rolling-month-calendar';
const API_KEY = 'e2e-access-token';

function out(array $value): never
{
    echo json_encode($value, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES), "\n";
    exit(0);
}

function plugin(): Plugin
{
    return Plugin::where('trmnlp_id', TRMNLP_ID)->firstOrFail();
}

[, $command] = $argv + [null, null];

switch ($command) {
    case 'setup':
        [, , $zip, $haUrl, $haToken] = $argv;
        $user = User::firstOrCreate(['email' => 'e2e@example.com'], [
            'name' => 'E2E', 'password' => bin2hex(random_bytes(16)), 'timezone' => 'Europe/Amsterdam',
        ]);
        $imported = app(PluginImportService::class)->importFromZip(
            new UploadedFile($zip, basename($zip), 'application/zip', null, true), $user);
        // the import sets an unsaved trmnlp_yaml attribute on the returned model
        $plugin = Plugin::findOrFail($imported->id);
        $plugin->update(['configuration' => array_merge($plugin->configuration ?? [], [
            'ha_url' => $haUrl, 'ha_token' => $haToken,
        ])]);

        $model = DeviceModel::where('name', 'v2')->firstOrFail(); // TRMNL X
        $device = Device::updateOrCreate(['api_key' => API_KEY], [
            'name' => 'E2E TRMNL X', 'mac_address' => 'E2:E2:E2:E2:E2:E2', 'friendly_id' => 'E2ETST',
            'user_id' => $user->id, 'device_model_id' => $model->id, 'default_refresh_interval' => 900,
        ]);
        $playlist = Playlist::firstOrCreate(['device_id' => $device->id], ['name' => 'E2E', 'is_active' => true]);
        PlaylistItem::firstOrCreate(['playlist_id' => $playlist->id, 'plugin_id' => $plugin->id], ['order' => 1]);

        out([
            'plugin_id' => $plugin->id, 'name' => $plugin->name, 'api_key' => API_KEY,
            'framework_version' => $plugin->framework_version, 'device_model' => $model->label,
            'missing_required_fields' => $plugin->hasMissingRequiredConfigurationFields(),
        ]);

    case 'configure':
        $plugin = plugin();
        $plugin->update([
            'configuration' => array_merge($plugin->configuration ?? [], json_decode($argv[2], true, flags: JSON_THROW_ON_ERROR)),
            'data_payload_updated_at' => null,
            'current_image' => null,
            'current_image_metadata' => null,
        ]);
        Device::where('api_key', API_KEY)->update(['current_screen_image' => null]);
        out(['configuration' => $plugin->configuration]);

    case 'check':
        $plugin = plugin();
        $device = Device::where('api_key', API_KEY)->firstOrFail();
        $payload = $plugin->data_payload;
        // one calendar is stored unwrapped ({data: [...]}, an ICS feed {ical: [...]}), several as IDX_n
        $single = is_array($payload) && (array_key_exists('data', $payload) || array_key_exists('ical', $payload));
        $calendars = $single ? ['IDX_0' => $payload] : ($payload ?? []);
        $summary = [];
        foreach ($calendars as $key => $calendar) {
            $summary[$key] = isset($calendar['error']) ? ['error' => $calendar['error']]
                : (isset($calendar['service_response']) ? ['forecast' => count(current($calendar['service_response'])['forecast'] ?? [])]
                : (isset($calendar['ical']) ? ['ical' => count($calendar['ical'])] : ['events' => count($calendar['data'] ?? [])]));
        }

        $image = null;
        if ($plugin->current_image) {
            $path = Storage::disk('public')->path("images/generated/{$plugin->current_image}.png");
            $im = new Imagick($path);
            $total = $im->getImageWidth() * $im->getImageHeight();
            $dark = 0;
            $levels = 0;
            foreach ($im->getImageHistogram() as $pixel) {
                $levels++;
                $c = $pixel->getColor(true);
                if (0.299 * $c['r'] + 0.587 * $c['g'] + 0.114 * $c['b'] < 0.5) {
                    $dark += $pixel->getColorCount();
                }
            }
            $image = [
                'path' => $path, 'width' => $im->getImageWidth(), 'height' => $im->getImageHeight(),
                'grey_levels' => $levels, 'dark_ratio' => round($dark / $total, 5),
            ];
        }

        out([
            'payload_keys' => is_array($payload) ? array_keys($payload) : null,
            'calendars' => (object) $summary,
            'plugin_image' => $plugin->current_image,
            'device_image' => $device->current_screen_image,
            'image' => $image,
        ]);

    case 'login':
        $user = User::where('email', 'e2e@example.com')->firstOrFail();
        $password = bin2hex(random_bytes(16));
        $user->forceFill(['password' => $password, 'email_verified_at' => now()])->save();
        out(['email' => $user->email, 'password' => $password, 'plugin_id' => plugin()->id]);

    case 'prerender':
        // The job looks 61-120 s ahead: last check-in plus the refresh interval
        $device = Device::where('api_key', API_KEY)->firstOrFail();
        $item = $device->getNextPlaylistItem();
        $interval = (int) ($item?->playlist->refresh_time ?? $device->default_refresh_interval);
        $device->forceFill(['last_refreshed_at' => now()->subSeconds($interval - 90)])->save();
        // On for this process only: in the app it stays off (LaraPaper's default), so the
        // scheduler can't race the scenarios before this. Toggles are
        // cached (the scheduler's check stored "off"), so without the cache, in a fresh
        // ToggleManager (it reads its config once).
        config(['toggle.flags.'.PrerenderUpcomingPlaylistItemsJob::TOGGLE => true, 'toggle.cache.enabled' => false]);
        app()->forgetInstance(ToggleManager::class);
        Toggle::clearResolvedInstance(ToggleManager::class);
        $queued = [];
        Event::listen(JobQueued::class, function (JobQueued $event) use (&$queued): void {
            $queued[] = ['job' => class_basename($event->job), 'force' => $event->job->force ?? null];
        });
        (new PrerenderUpcomingPlaylistItemsJob)->handle();
        out(['queued' => $queued]);

    default:
        fwrite(STDERR, "usage: php larapaper.php setup|configure|check|login|device|prerender ...\n");
        exit(2);
}
