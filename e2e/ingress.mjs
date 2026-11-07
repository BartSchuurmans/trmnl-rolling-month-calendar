// End-to-end test of the web UI through Home Assistant ingress.
//
//   node e2e/ingress.mjs [--container app] [--ingress http://localhost:8099]
//
// Run after e2e/run.mjs (it needs that user, recipe and device). Needs the app's ingress
// port published (docker run -p 127.0.0.1:8099:8099) and allowed from Docker's network
// (-e HA_INGRESS_PROXY=172.16.0.0/12), and Chromium for playwright-core (preview/).
// A fake Home Assistant on :8130 does what Home Assistant's ingress does: forwards
// /api/hassio_ingress/<token>/... to the app without the prefix, with X-Ingress-Path and
// X-Forwarded-*, and answers everything else itself (404). In Chromium it then logs in,
// opens the dashboard and the recipe's preview and renders an image, and fails on any
// request that misses the prefix or fails.
import { execFileSync } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';

const { chromium } = createRequire(new URL('../preview/package.json', import.meta.url))('playwright-core');

const dir = path.dirname(new URL(import.meta.url).pathname);
const opt = { container: 'app', ingress: 'http://localhost:8099' };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i += 2) opt[argv[i].replace(/^--/, '')] = argv[i + 1];

const PORT = 8130;
const PREFIX = '/api/hassio_ingress/e2e_Ingress-Token1';
const base = `http://localhost:${PORT}${PREFIX}`;
const outDir = path.join(dir, 'out');
fs.mkdirSync(outDir, { recursive: true });

let failures = 0;
const check = (ok, message) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
  if (!ok) failures++;
};

const escaped = [];
const server = http.createServer((req, res) => {
  if (!req.url.startsWith(`${PREFIX}/`) && req.url !== PREFIX) {
    // (browsers ask for /favicon.ico by themselves; Home Assistant has one)
    if (req.url !== '/favicon.ico') escaped.push(`${req.method} ${req.url}`);
    res.writeHead(404).end('Home Assistant: not found');
    return;
  }
  const target = new URL(req.url.slice(PREFIX.length) || '/', opt.ingress);
  const headers = { ...req.headers, 'x-ingress-path': PREFIX, 'x-forwarded-host': req.headers.host,
    'x-forwarded-proto': 'http', 'x-hass-source': 'core.ingress' };
  delete headers['accept-encoding'];
  const upstream = http.request(target, { method: req.method, headers }, (up) => {
    res.writeHead(up.statusCode, up.headers);
    up.pipe(res);
  });
  upstream.on('error', (e) => res.writeHead(502).end(String(e)));
  req.pipe(upstream);
});
await new Promise((resolve) => server.listen(PORT, resolve));

const login = JSON.parse(execFileSync('docker', ['exec', '-u', 'www-data', '-w', '/var/www/html', opt.container,
  'php', '/tmp/e2e/larapaper.php', 'login'], { encoding: 'utf8' }));

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1000 } });
  const failed = [];
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => failed.push(`${r.failure()?.errorText} ${r.url()}`));
  page.on('pageerror', (e) => failed.push(`page error: ${e.message}`));

  // Home Assistant opens the ingress path's root: LaraPaper's welcome page, whose
  // login link stays under the prefix
  await page.goto(`${base}/`);
  await Promise.all([page.waitForURL(`${base}/login`, { timeout: 30000 }).catch(() => {}),
    page.click(`a[href="${base}/login"]`)]);
  check(page.url() === `${base}/login`, `welcome page links to the login page (${page.url()})`);
  await page.fill('input[name="email"]', login.email);
  await page.fill('input[name="password"]', login.password);
  await Promise.all([page.waitForURL(`${base}/dashboard`, { timeout: 30000 }).catch(() => {}),
    page.click('[data-test="login-button"]')]);
  check(page.url() === `${base}/dashboard`, `logged in, on the dashboard (${page.url()})`);
  await page.waitForLoadState('networkidle');

  // the device's screen: LaraPaper links it at APP_URL, which only the home network reaches
  const screens = await page.$$eval('img', (imgs) => imgs.filter((i) => i.src.includes('/storage/'))
    .map((i) => ({ src: i.src, loaded: i.complete && i.naturalWidth > 0 })));
  check(screens.length > 0 && screens.every((s) => s.src.startsWith(`${base}/storage/`) && s.loaded),
    `dashboard screen images load through ingress (${JSON.stringify(screens)})`);
  await page.screenshot({ path: path.join(outDir, 'ingress-dashboard.png') });

  // the recipe: Livewire's update requests, the HTML preview with the bundled framework,
  // fonts and FullCalendar, and a server-side render
  await page.goto(`${base}/plugins/recipe/${login.plugin_id}`);
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: 'Preview', exact: true }).first().click();
  const frame = page.frameLocator('#preview-frame');
  const rendered = await frame.locator('.trmnl-calendar').first().waitFor({ timeout: 30000 }).then(() => true, () => false);
  check(rendered, 'HTML preview renders the calendar');
  const preview = await page.$eval('#preview-frame', async (f) => {
    const doc = f.contentDocument;
    await doc.fonts.ready;
    return {
      sheets: [...doc.styleSheets].map((s) => { try { return [s.href, s.cssRules.length]; } catch { return [s.href, -1]; } })
        .filter(([href]) => href),
      fullcalendar: !!f.contentWindow.FullCalendar,
      fonts: [...doc.fonts].filter((x) => x.status === 'loaded').map((x) => x.family),
      scripts: [...doc.scripts].map((s) => s.src).filter(Boolean),
    };
  });
  console.log(JSON.stringify(preview));
  check(preview.sheets.some(([href, n]) => href.startsWith(`${base}/trmnl-framework/`) && n > 0),
    'preview loads the bundled framework stylesheet through ingress');
  check(preview.fullcalendar && preview.scripts.some((s) => s.startsWith(`${base}/rolling-month-calendar/`))
    && !preview.scripts.some((s) => s.includes('jsdelivr')), 'preview loads the bundled FullCalendar through ingress');
  check(preview.fonts.length > 0, `preview loads the framework fonts (${[...new Set(preview.fonts)].join(', ')})`);
  await page.screenshot({ path: path.join(outDir, 'ingress-preview.png') });

  await page.getByRole('button', { name: 'Render Image' }).click();
  const image = await page.locator('#preview-image').waitFor({ state: 'visible', timeout: 60000 })
    .then(() => page.$eval('#preview-image', async (i) => {
      await i.decode().catch(() => {});
      return { src: i.src, width: i.naturalWidth };
    }), () => null);
  check(image?.src.startsWith(`${base}/storage/`) && image.width > 0, `rendered image loads through ingress (${JSON.stringify(image)})`);

  check(failed.length === 0, `no failed requests or page errors${failed.length ? `:\n  ${failed.join('\n  ')}` : ''}`);
  check(escaped.length === 0, `no requests outside the ingress path${escaped.length ? `:\n  ${escaped.join('\n  ')}` : ''}`);
} finally {
  await browser.close();
  server.close();
}

console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
