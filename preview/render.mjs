// Local preview: renders plugin/src/{shared,full}.liquid the way LaraPaper does and
// screenshots it. Like LaraPaper, the browser window is the device's pixel size at 1x
// (1872x1404 for the TRMNL X) inside the same screen markup and framework version, so
// the framework applies the same scale, fonts and grey patterns.
//
//   node render.mjs                         sample events → out/preview.png
//   HA_URL=http://ha:8123 HA_TOKEN=... HA_CALENDARS=calendar.family,calendar.work node render.mjs
//   node render.mjs --set first_day=0 --set time_format=am/pm --device og
//   node render.mjs --set weather_entity=weather.home      with a sample weather forecast
//
// For CI: --dump-context <file> writes the Liquid render context as JSON, --body <file>
// screenshots markup rendered elsewhere (e.g. by LaraPaper's PHP Liquid, php/render.php),
// and --strict exits non-zero on JavaScript errors in the page. --now YYYY-MM-DD renders
// as if it were noon on that day (sample events and the recipe's "today"), so
// screenshots don't change from one day to the next.
//
// --ics serves the same events (sample, --data or live) as ICS feeds would reach the
// recipe on LaraPaper: parsed into { ical: [...] } by its IcalResponseParser, only events
// from 7 days back to 45 days ahead, dates as ISO strings with an offset (all-day ones
// at midnight UTC, flagged all_day). It also fills in ics_urls, which switches the recipe to ICS.
//
// --merge renders as TRMNL.com does with the Plugin Merge strategy: each calendar's data at
// the top level as caldav_<id>, the "Calendar" dropdowns (calendar_1, ...) naming them, and
// plugin/trmnl-com-merge/merge.liquid prepended to the shared markup.
//
// --merge-weather trmnl|open-meteo adds a forecast in the Weather dropdown (weather_plugin):
// TRMNL's Weather plugin (today and tomorrow) or a recipe polling Open-Meteo (Daily Weather).
//
// --size half_horizontal|half_vertical|quadrant renders that view as part of a mashup.
//
// --expect-events fails the render when no event made it onto the grid.
//
// --scale regular|large|... renders at that screen scale (screen--scale-*) instead of the
// device's: LaraPaper's TRMNL X is xxlarge, a TRMNL.com device the scale its owner picked
// (regular by default).
//
// Like LaraPaper's image stage (bnussbau/epaper-pipeline-php), the screenshot is
// reduced to the device's grey levels: 4-bit is always Floyd–Steinberg dithered,
// 1-/2-bit only when the page contains <img class="image-dither">. --raw skips this.
//
// The TRMNL framework (CSS, JS, fonts) loads from trmnl.com, or from a local copy when
// FRAMEWORK_DIR points at a directory with css/<v>/, js/<v>/ and fonts/ (the public/
// folder of github.com/usetrmnl/trmnl-framework at that version's tag). FullCalendar
// is served from node_modules.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Liquid } from 'liquidjs';
import * as yaml from 'js-yaml';
import { chromium } from 'playwright-core';
import { sampleData, sampleForecast, sampleOpenMeteo, sampleTrmnlWeather } from './sample-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'plugin', 'src');
const outDir = path.join(here, 'out');

// Screen classes and CSS variables as LaraPaper sets them for its seeded device models
// (DeviceModel css_name / color_depth / scale_level / css_variables).
const DEVICES = {
  x: { width: 1872, height: 1404, classes: 'screen--v2 screen--4bit screen--scale-xxlarge', depth: '4bit', vars: {} },
  og: { width: 800, height: 480, classes: 'screen--og_png screen--1bit', depth: '1bit', vars: { '--ui-scale': '1.0', '--gap-scale': '1.0' } },
  og2: { width: 800, height: 480, classes: 'screen--og_png screen--2bit', depth: '2bit', vars: { '--ui-scale': '1.0', '--gap-scale': '1.0' } },
};

const args = process.argv.slice(2);
const overrides = {};
let deviceName = 'x';
let raw = false;
let dataFile = null;
let dumpContext = null;
let bodyFile = null;
let strict = false;
let ics = false;
let size = 'full';
let merge = false;
let mergeWeather = null;
let expectEvents = false;
let scale = null;
let now = new Date();
let out = path.join(outDir, 'preview.png');
let timeZone = process.env.TZ_NAME || Intl.DateTimeFormat().resolvedOptions().timeZone;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--set') { const [k, ...v] = args[++i].split('='); overrides[k] = v.join('='); }
  else if (args[i] === '--device') deviceName = args[++i];
  else if (args[i] === '--size') size = args[++i];
  else if (args[i] === '--raw') raw = true;
  else if (args[i] === '--data') dataFile = args[++i];
  else if (args[i] === '--dump-context') dumpContext = args[++i];
  else if (args[i] === '--body') bodyFile = args[++i];
  else if (args[i] === '--strict') strict = true;
  else if (args[i] === '--out') out = path.resolve(args[++i]);
  else if (args[i] === '--tz') timeZone = args[++i];
  else if (args[i] === '--now') now = new Date(`${args[++i]}T12:00:00`);
  else if (args[i] === '--ics') ics = true;
  else if (args[i] === '--merge') merge = true;
  else if (args[i] === '--merge-weather') { merge = true; mergeWeather = args[++i]; }
  else if (args[i] === '--expect-events') expectEvents = true;
  else if (args[i] === '--scale') scale = args[++i];
}
const device = DEVICES[deviceName];
if (device && scale) device.classes = device.classes.replace(/ screen--scale-\S+|$/, ` screen--scale-${scale}`);
if (!device) throw new Error(`unknown device ${deviceName}`);

const settings = yaml.load(fs.readFileSync(path.join(src, 'settings.yml'), 'utf8'));
// no_screen_padding: 'yes' (as every variant has it) is screen--no-bleed on TRMNL.com and in
// LaraPaper (its "Remove bleed margin?" box)
if (settings.no_screen_padding === 'yes') device.classes += ' screen--no-bleed';
// --set takes only the recipe's settings (with --merge, the merge variant's too), so a
// setting that's gone can't linger in a check that no longer tests anything
const known = new Set(settings.custom_fields.map((f) => f.keyname));
if (merge) {
  for (const f of yaml.load(fs.readFileSync(path.join(src, '..', 'trmnl-com-merge', 'settings.yml'), 'utf8')).custom_fields) known.add(f.keyname);
}
const unknown = Object.keys(overrides).filter((k) => !known.has(k));
if (unknown.length) throw new Error(`not a setting: ${unknown.join(', ')}`);
const customFields = {};
// Like LaraPaper: boolean fields hold true/false, the rest text. --set x=true|false gives a
// boolean field a boolean; "yes"/"no" stay text, as installs from before the booleans saved them.
const booleans = new Set(settings.custom_fields.filter((f) => f.field_type === 'boolean').map((f) => f.keyname));
for (const f of settings.custom_fields) {
  if (f.default !== undefined) customFields[f.keyname] = booleans.has(f.keyname) ? f.default : String(f.default);
}
if (process.env.HA_CALENDARS) customFields.calendars = process.env.HA_CALENDARS;
for (const [k, v] of Object.entries(overrides)) {
  customFields[k] = booleans.has(k) && (v === 'true' || v === 'false') ? v === 'true' : v;
}

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);

async function liveData() {
  const base = process.env.HA_URL.replace(/\/$/, '');
  const today = new Date(now);
  const q = `start=${iso(addDays(today, -7))}&end=${iso(addDays(today, 43))}`;
  const cals = (customFields.calendars || '').split(',').map((c) => c.trim()).filter(Boolean);
  const results = await Promise.all(cals.map(async (cal) => {
    const res = await fetch(`${base}/api/calendars/${cal}?${q}`, {
      headers: { Authorization: `Bearer ${process.env.HA_TOKEN}`, Accept: 'application/json' },
    });
    if (!res.ok) { console.warn(`${cal}: HTTP ${res.status}`); return { error: 'Failed to fetch data' }; }
    return { data: await res.json() };
  }));
  // same shape LaraPaper stores: one URL unwrapped, several keyed IDX_n
  if (results.length === 1) return results[0];
  return Object.fromEntries(results.map((r, i) => [`IDX_${i}`, r]));
}

// HA events as LaraPaper hands over a parsed ICS feed (IcalResponseParser): uppercase
// iCalendar keys, all-day dates at midnight in the feed's floating zone or UTC and flagged
// all_day, events without an end dropped, and only events overlapping 7 days back to 45
// days ahead.
function toIcal(calendar) {
  if (!calendar || calendar.error || !Array.isArray(calendar.data)) return calendar;
  const from = now.getTime() - 7 * 86400000, to = now.getTime() + 45 * 86400000;
  const at = (t) => (t.dateTime ? new Date(t.dateTime) : new Date(`${t.date}T00:00:00Z`));
  const atom = (t) => (t.dateTime ? t.dateTime : `${t.date}T00:00:00+00:00`);
  const ical = calendar.data.filter((e) => e.end).filter((e) => {
    const s = at(e.start).getTime(), en = at(e.end).getTime();
    return (s >= from && s < to) || (en > from && en <= to) || (from >= s && to <= en);
  }).map((e) => ({
    UID: e.uid || undefined, DTSTART: atom(e.start), DTEND: atom(e.end),
    ...(e.summary ? { SUMMARY: e.summary } : {}), ...(e.description ? { DESCRIPTION: e.description } : {}),
    ...(e.location ? { LOCATION: e.location } : {}),
    all_day: !e.start.dateTime,
  }));
  return { ical };
}

// HA events as a native TRMNL calendar plugin shares them (its Plugin Merge data, under
// `data` here): { data: { events: [...] } } with start_full/end_full, all-day ones as plain dates.
function toNative(calendar) {
  if (!calendar || calendar.error || !Array.isArray(calendar.data)) return calendar;
  const at = (t) => t.dateTime || t.date;
  const events = calendar.data.map((e) => ({
    summary: e.summary || 'Busy', description: e.description || '', status: 'confirmed',
    // TRMNL's CalDAV plugin flags a timed event over several days all_day as well
    date_time: at(e.start), all_day: !e.start.dateTime || at(e.start).slice(0, 10) !== at(e.end).slice(0, 10),
    location: e.location || null,
    start_full: at(e.start), end_full: at(e.end),
  }));
  return { data: { events } };
}

const todayYmd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
let payload = dataFile ? JSON.parse(fs.readFileSync(dataFile, 'utf8'))
  : process.env.HA_URL ? await liveData()
  : sampleData(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, timeZone);
if (!dataFile && !process.env.HA_URL && !overrides.calendars) customFields.calendars = 'calendar.family,calendar.mark,calendar.sara';
// Plugin Merge: no polled payload, the chosen plugins' data sits at the top level
let merged = {};
if (merge) {
  const idx = Object.keys(payload).filter((k) => /^IDX_\d+$/.test(k));
  const cals = idx.length ? idx.map((k) => payload[k]) : [Array.isArray(payload) ? { data: payload } : payload];
  cals.forEach((cal, i) => {
    const key = `caldav_${10001 + i}`;
    merged[key] = toNative(cal).data;
    if (!overrides[`calendar_${i + 1}`]) customFields[`calendar_${i + 1}`] = key;
  });
  payload = {};
  if (mergeWeather) {
    const key = mergeWeather === 'trmnl' ? 'weather_10101' : 'private_plugin_10102';
    // a recipe's data comes wrapped in merge_variables, a native plugin's as it is
    merged[key] = mergeWeather === 'trmnl' ? sampleTrmnlWeather()
      : { merge_variables: sampleOpenMeteo(todayYmd), custom_fields_values: { latitude: '52.37', longitude: '4.89', temperature_unit: 'celsius' } };
    if (!overrides.weather_plugin) customFields.weather_plugin = key;
  }
}
if (ics) {
  const idx = Object.keys(payload).filter((k) => /^IDX_\d+$/.test(k));
  payload = idx.length ? Object.fromEntries(idx.map((k) => [k, toIcal(payload[k])]))
    : toIcal(Array.isArray(payload) ? { data: payload } : payload);
  if (!overrides.ics_urls) {
    customFields.ics_urls = (idx.length ? idx : ['IDX_0']).map((_, i) => `https://calendar.example/${i + 1}.ics`).join(',');
  }
}

// A weather entity (weather_entity) adds its forecast as the last polled URL; without
// live data, the sample one
const weatherEntity = (customFields.weather_entity || '').trim();
if (weatherEntity.startsWith('weather.') && !merge && !dataFile && !process.env.HA_URL) {
  const idx = Object.keys(payload).filter((k) => /^IDX_\d+$/.test(k));
  if (!idx.length) payload = { IDX_0: payload };
  payload[`IDX_${idx.length || 1}`] = sampleForecast(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`, weatherEntity);
}

// LaraPaper render context: `data` is the payload, then the payload keys are spread
// on top (so a single calendar's { data: [...] } turns `data` into the bare list).
const context = {
  size,
  ...(merge ? {} : { data: payload }),
  config: customFields,
  ...payload,
  ...merged,
  trmnl: {
    system: { timestamp_utc: Math.floor(now.getTime() / 1000) },
    user: { locale: 'en', time_zone_iana: timeZone, utc_offset: '0', name: 'Preview' },
    device: { width: device.width, height: device.height },
    plugin_settings: { instance_name: settings.name, custom_fields_values: customFields },
  },
};

if (dumpContext) fs.writeFileSync(dumpContext, JSON.stringify(context, null, 1));

const engine = new Liquid();
// The view wrapper comes from the platform, as on TRMNL: LaraPaper adds it to each view
// on import (PluginImportService::ensureLiquidViewWrapper) and prepends shared.liquid.
const MASHUPS = { full: null, half_horizontal: 'mashup--1Tx1B', half_vertical: 'mashup--1Lx1R', quadrant: 'mashup--2x2' };
if (!(size in MASHUPS)) throw new Error(`unknown size ${size}`);
const view = `<div class="view view--${size}">\n${fs.readFileSync(path.join(src, `${size}.liquid`), 'utf8')}\n</div>`;
const shared = (merge ? fs.readFileSync(path.join(src, '..', 'trmnl-com-merge', 'merge.liquid'), 'utf8') + '\n' : '')
  + fs.readFileSync(path.join(src, 'shared.liquid'), 'utf8');
const markup = shared + '\n' + (MASHUPS[size]
  // A half or quadrant is one view in a mashup; the others are left empty here
  ? `<div class="mashup ${MASHUPS[size]}">${view}${`<div class="view view--${size}"></div>`.repeat(size === 'quadrant' ? 3 : 1)}</div>` : view);
const body = bodyFile ? fs.readFileSync(bodyFile, 'utf8') : await engine.parseAndRender(markup, context);

// LaraPaper's resources/views/vendor/trmnl/components/screen.blade.php
const fw = settings.framework_version || '3.3.1';
const vars = { '--screen-w': `${device.width}px`, '--screen-h': `${device.height}px`, ...device.vars };
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<link rel="stylesheet" href="https://trmnl.com/css/${fw}/plugins.css">
<script src="https://trmnl.com/js/${fw}/plugins.js"></script>
<style>:root { ${Object.entries(vars).map(([k, v]) => `${k}: ${v};`).join(' ')} }</style>
</head><body class="environment trmnl"><div class="screen ${device.classes}">${body}</div></body></html>`;

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out.replace(/\.png$/, '.html'), html);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ viewport: { width: device.width, height: device.height }, deviceScaleFactor: 1, timezoneId: 'UTC' });
const nm = path.join(here, 'node_modules');
await page.route('https://cdn.jsdelivr.net/npm/**', (route) => {
  const rel = new URL(route.request().url()).pathname.replace(/^\/npm\//, '').replace(/@[\d.]+/, '');
  const file = path.join(nm, rel);
  return fs.existsSync(file) ? route.fulfill({ path: file, contentType: file.endsWith('.css') ? 'text/css' : 'application/javascript' }) : route.abort();
});
const frameworkDir = process.env.FRAMEWORK_DIR;
await page.route('https://trmnl.com/**', (route) => {
  if (!frameworkDir) return route.continue().catch(() => route.abort());
  const file = path.join(frameworkDir, new URL(route.request().url()).pathname);
  return fs.existsSync(file) ? route.fulfill({ path: file }) : route.abort();
});
page.on('console', (m) => { if (['error', 'warning'].includes(m.type()) && !m.text().includes('parser-blocking')) console.warn(`[browser] ${m.text()}`); });
const pageErrors = [];
page.on('pageerror', (e) => { pageErrors.push(e.message); console.error(`[browser] ${e.message}`); });
await page.setContent(html, { waitUntil: 'load', timeout: 20000 }).catch(() => {});
await page.waitForSelector('.trmnl-calendar[data-initialized]', { timeout: 10000 });
if (strict && pageErrors.length) {
  await browser.close();
  throw new Error(`JavaScript errors in the page: ${pageErrors.join('; ')}`);
}
await page.waitForTimeout(300);
if (expectEvents && !(await page.locator('.mono-event').count())) {
  await browser.close();
  throw new Error('no events on the grid');
}
// a sample forecast must show up next to the day numbers
const forecastDays = (mergeWeather || weatherEntity.startsWith('weather.')) && '.trmnl-weather';
if (forecastDays && !(await page.locator(forecastDays).count())) {
  await browser.close();
  throw new Error('no weather forecast on the screen');
}
const shot = await page.screenshot();
if (raw) {
  fs.writeFileSync(out, shot);
} else {
  const bits = parseInt(device.depth, 10);
  const dither = bits > 2 || /<img\b[^>]*\bclass\s*=\s*(["'])(?:[^"']*\s)?image--?dither(?:\s[^"']*)?\1/i.test(html);
  const png = await page.evaluate(async ({ src, bits, dither }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = img.width; canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const im = ctx.getImageData(0, 0, img.width, img.height);
    const d = im.data, w = img.width, h = img.height;
    const levels = (1 << bits) - 1;
    const grey = new Float32Array(w * h);
    for (let i = 0; i < w * h; i++) grey[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const v = Math.round(Math.min(255, Math.max(0, grey[i])) / 255 * levels) * 255 / levels;
        const err = grey[i] - v;
        grey[i] = v;
        if (!dither) continue;
        if (x + 1 < w) grey[i + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) grey[i + w - 1] += err * 3 / 16;
          grey[i + w] += err * 5 / 16;
          if (x + 1 < w) grey[i + w + 1] += err * 1 / 16;
        }
      }
    }
    for (let i = 0; i < w * h; i++) { d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = grey[i]; d[i * 4 + 3] = 255; }
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png').split(',')[1];
  }, { src: `data:image/png;base64,${shot.toString('base64')}`, bits, dither });
  fs.writeFileSync(out, Buffer.from(png, 'base64'));
  console.log(`${device.depth}${dither ? ', dithered' : ''}`);
}
await browser.close();
console.log(`wrote ${path.relative(process.cwd(), out)}`);
