<?php
// Renders plugin/src/{shared,full}.liquid with keepsuit/liquid 0.12.1, the Liquid engine
// and version LaraPaper 0.44.0 uses, and checks the polling URLs and headers (Home
// Assistant and ICS) the way LaraPaper resolves them (Plugin::resolveLiquidVariables).
//
//   php render.php <context.json> > body.html      (context from render.mjs --dump-context)
//
// Checks fail with a non-zero exit; the rendered markup goes to stdout.

require __DIR__.'/vendor/autoload.php';

use Keepsuit\Liquid\EnvironmentFactory;
use Keepsuit\Liquid\Filters\FiltersProvider;
use Symfony\Component\Yaml\Yaml;

// LaraPaper's App\Liquid\Filters\Data::json
class DataFilters extends FiltersProvider
{
    public function json(mixed $value): string
    {
        return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}

function fail(string $message): never
{
    fwrite(STDERR, "FAIL: $message\n");
    exit(1);
}

$src = __DIR__.'/../../plugin/src/';
$context = json_decode(file_get_contents($argv[1] ?? fail('usage: php render.php <context.json>')), true)
    ?? fail('context is not valid JSON');
$settings = Yaml::parse(preg_split('/^---[ \t]*\r?\n/m', file_get_contents($src.'settings.yml'), 2)[1]);

$config = $context['trmnl']['plugin_settings']['custom_fields_values'];
$config['ha_url'] = 'http://homeassistant:8123';
$config['ha_token'] = 'test.token';
$config['ics_urls'] = ''; // the markup is rendered from the context as it is, whatever the source
$config['weather_entity'] = ''; // checked below

$environment = EnvironmentFactory::new()->setRethrowErrors(true)->build();
$resolve = fn (string $template, array $data) => $environment->parseString($template)->render($environment->newRenderContext(data: $data));

// Polling URLs: one per calendar entity, dated around today (timestamp maths, which PHP
// and Ruby Liquid read alike)
$urls = array_values(array_filter(array_map('trim', explode("\n", $resolve($settings['polling_url'], $config)))));
$entities = array_values(array_filter(array_map('trim', explode(',', $config['calendars'] ?? ''))));
count($urls) === count($entities) || fail('expected '.count($entities).' polling URLs, got '.count($urls).': '.implode(' ', $urls));
$today = date('Y-m-d');
foreach ($urls as $i => $url) {
    preg_match('#^http://homeassistant:8123/api/calendars/'.preg_quote($entities[$i], '#').'\?start=(\d{4}-\d{2}-\d{2})&end=(\d{4}-\d{2}-\d{2})$#', $url, $m)
        || fail("unexpected polling URL: $url");
    $m[1] === date('Y-m-d', strtotime('-7 days')) && $m[2] === date('Y-m-d', strtotime('+43 days'))
        || fail("polling window $m[1]..$m[2] is not 7 days back to 43 days ahead of $today");
}

// Header: LaraPaper's importer turns "=" into ":" before resolving
$header = fn (array $values) => trim($resolve(str_replace('=', ':', $settings['polling_headers']), $values));
$header($config) === 'Authorization:Bearer test.token' || fail('unexpected polling header: '.$header($config));

// ICS feeds replace the entities: fetched as given (webcal:// as https://), no token
$ics = [...$config, 'ics_urls' => 'https://calendar.example/a.ics, webcal://calendar.example/b.ics?x=1&y=2'];
$icsUrls = array_values(array_filter(array_map('trim', explode("\n", $resolve($settings['polling_url'], $ics)))));
$icsUrls === ['https://calendar.example/a.ics', 'https://calendar.example/b.ics?x=1&y=2']
    || fail('unexpected ICS polling URLs: '.implode(' ', $icsUrls));
$header($ics) === '' || fail('the Home Assistant token is sent to ICS feeds: '.$header($ics));

// A weather entity adds its forecast, through the app's proxy at the Home Assistant URL,
// as the last URL; with ICS feeds too
$weather = fn (array $values) => array_values(array_filter(array_map('trim',
    explode("\n", $resolve($settings['polling_url'], [...$values, 'weather_entity' => ' weather.forecast_home '])))));
$weather($config) === [...$urls, 'http://homeassistant:8123/api/weather/weather.forecast_home']
    || fail('unexpected polling URLs with a weather entity: '.implode(' ', $weather($config)));
$weather($ics) === [...$icsUrls, 'http://homeassistant:8123/api/weather/weather.forecast_home']
    || fail('unexpected ICS polling URLs with a weather entity: '.implode(' ', $weather($ics)));

// Markup, with the same filters and context shape as Plugin::render; the view wrapper is
// what PluginImportService::ensureLiquidViewWrapper adds to full.liquid on import
$environment->filterRegistry->register(DataFilters::class);
$markup = file_get_contents($src.'shared.liquid')."\n".'<div class="view view--{{ size }}">'."\n".file_get_contents($src.'full.liquid')."\n</div>";
$html = $resolve($markup, $context);

str_contains($html, 'data-calendar-config=') || fail('rendered markup has no calendar element');
foreach (['file:', '//localhost', '//127.'] as $blocked) { // Browsershot::setHtml rejects these
    stripos($html, $blocked) === false || fail("rendered markup contains \"$blocked\", which Browsershot rejects");
}

// On/off settings: boolean fields now, "yes"/"no" text in installs from before. Each must
// read the same either way, fall back to its default when unset, and change the markup.
$withSetting = function (string $key, mixed $value) use ($context): array {
    $values = &$context['trmnl']['plugin_settings']['custom_fields_values'];
    if ($value === null) unset($values[$key]); else $values[$key] = $value;
    return $context;
};
$read = function (array $context) use ($resolve, $markup): string {
    $html = $resolve($markup, $context);
    preg_match('/<div class="(trmnl-calendar [^"]*)"/', $html, $class);
    preg_match("/data-calendar-config='([^']*)'/", $html, $config);
    return ($class[1] ?? '?').' '.preg_replace('/"nowUtc": *\d+/', '', $config[1] ?? '?').(str_contains($html, 'class="title_bar"') ? ' title_bar' : '');
};
$toggles = array_filter($settings['custom_fields'], fn ($f) => $f['field_type'] === 'boolean');
count($toggles) > 0 || fail('no boolean fields in settings.yml');
foreach ($toggles as $field) {
    $key = $field['keyname'];
    $on = $read($withSetting($key, true));
    $off = $read($withSetting($key, false));
    $on !== $off || fail("$key: true and false render the same");
    $read($withSetting($key, 'yes')) === $on || fail("$key: \"yes\" doesn't read as true");
    $read($withSetting($key, 'no')) === $off || fail("$key: \"no\" doesn't read as false");
    $read($withSetting($key, null)) === ($field['default'] ? $on : $off) || fail("$key: unset doesn't read as its default");
}

fwrite(STDERR, 'ok: '.count($urls)." polling URL(s), header, markup, ".count($toggles)." on/off settings\n");
echo $html;
