<?php
// Renders recipe screens ahead of time (LaraPaper (local) app). Runs as the s6 service
// larapaper-local-prerender, once a minute, as www-data.
//
// LaraPaper only renders when a device asks for its screen (GET /api/display): if the
// recipe's data is older than its refresh interval, it polls the data and renders the
// screen inside that request. The TRMNL firmware gives that request 15 seconds, and a
// render on a Home Assistant machine can take longer, so the device times out, and since
// the render still finishes after that, the data is stale again on the next wake. This
// script renders each polling recipe in a device's playlists a little before its data
// goes stale (LEAD_SECONDS), the way LaraPaper itself would on a request, so
// /api/display finds a fresh screen and only has to hand it out.
//
// Through LaraPaper's own services, without changing LaraPaper: what RunDeviceDisplayCycle
// does for one playlist item, minus advancing the playlist and setting the device's
// screen (the device's next request does both). Mashups are left alone, as LaraPaper
// renders them on every request anyway.
//
//   php prerender.php           render what is due
//   php prerender.php --dry-run list what is due
//   php prerender.php --device <id>
//                               render that device's recipes now, due or not (the
//                               Refresh screen button in Home Assistant, see mqtt.php)

use App\Models\Device;
use App\Models\Plugin;
use App\Services\ImageGenerationService;
use Illuminate\Support\Facades\Cache;

$root = getenv('LARAPAPER_DIR') ?: '/var/www/html';
require "$root/vendor/autoload.php";
$app = require "$root/bootstrap/app.php";
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

// Render this long before the data goes stale: more than this script's own interval,
// so a screen is never stale when the device wakes
const LEAD_SECONDS = 120;
// Shorter refresh intervals are left to LaraPaper: pre-rendering wouldn't save a render
const MIN_REFRESH_MINUTES = 5;

$dryRun = in_array('--dry-run', $argv, true);
$forceDevice = ($i = array_search('--device', $argv, true)) !== false ? (int) ($argv[$i + 1] ?? 0) : null;

function say(string $message): void
{
    echo "[larapaper-local] prerender: $message\n";
}

function isDue(Plugin $plugin, Device $device): bool
{
    if ($plugin->current_image === null || $plugin->data_payload_updated_at === null) {
        return true;
    }
    // Rendered for another device model (LaraPaper would render it again on request)
    if (! ImageGenerationService::imageMetadataMatches($plugin->current_image_metadata, $device)) {
        return true;
    }

    return $plugin->data_payload_updated_at->copy()
        ->addMinutes($plugin->data_stale_minutes)
        ->subSeconds(LEAD_SECONDS)
        ->isPast();
}

function prerender(Plugin $plugin, Device $device): void
{
    $plugin->updateDataPayload();
    $plugin->refresh();

    // LaraPaper skips these on request; leave them to it
    if (is_array($plugin->data_payload) && ($plugin->data_payload['TRMNL_SKIP_DISPLAY'] ?? false) === true) {
        return;
    }
    $markup = $plugin->render(device: $device);
    if (preg_match('/<script\b[^>]*>.*?window\.TRMNL_SKIP_DISPLAY\s*=\s*true\b.*?<\/script>/is', $markup) === 1) {
        return;
    }

    // As GenerateScreenJob, but without making it the device's current screen
    $imageId = ImageGenerationService::generateImageFromModel(
        markup: $markup,
        deviceModel: $device->deviceModel,
        user: $device->user,
        palette: $device->palette ?? $device->deviceModel?->palette,
        device: $device,
        plugin: $plugin,
        existingImageId: $plugin->current_image,
    );
    $plugin->update([
        'current_image' => $imageId,
        'current_image_metadata' => ImageGenerationService::buildImageMetadataFromDevice($device),
        'data_payload_updated_at' => now(),
    ]);
    ImageGenerationService::cleanupFolder();
}

// A plugin keeps one screen, so it is rendered for the first device that shows it.
// Mirrors show their source's screen.
$done = [];
$devices = Device::with(['deviceModel', 'deviceModel.palette', 'palette', 'user'])
    ->whereNull('mirror_device_id')->when($forceDevice !== null, fn ($q) => $q->whereKey($forceDevice))
    ->orderBy('id')->get();
foreach ($devices as $device) {
    foreach ($device->playlists()->where('is_active', true)->get() as $playlist) {
        foreach ($playlist->getActiveItems() as $item) {
            $plugin = $item->isMashup() ? null : $item->plugin;
            if (! $plugin || isset($done[$plugin->id])) {
                continue;
            }
            $done[$plugin->id] = true;
            // Only polled recipes go stale on a timer
            if ($plugin->plugin_type !== 'recipe' || $plugin->data_strategy !== 'polling'
                || ($forceDevice === null && ((int) $plugin->data_stale_minutes < MIN_REFRESH_MINUTES
                    || Cache::has("larapaper-local-prerender-failed-$plugin->id") || ! isDue($plugin, $device)))) {
                continue;
            }
            if ($dryRun) {
                say("due: $plugin->name for $device->name");

                continue;
            }
            $start = microtime(true);
            try {
                prerender($plugin, $device);
                say(sprintf('rendered %s for %s in %.1f s', $plugin->name, $device->name, microtime(true) - $start));
            } catch (Throwable $e) {
                // Left to the device's own request (which shows LaraPaper's error screen if
                // it fails too) for one refresh interval, rather than retried every minute
                say("$plugin->name for $device->name failed: ".$e->getMessage());
                Cache::put("larapaper-local-prerender-failed-$plugin->id", true, now()->addMinutes($plugin->data_stale_minutes));
            }
        }
    }
}
