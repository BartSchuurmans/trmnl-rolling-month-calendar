// Checks the stand-in Home Assistant on Cloudflare Workers (sample-server/worker.mjs, served
// here by Node) with TRMNL.com's serverless function (plugin/trmnl-com-polling/transform.js),
// run the way TRMNL.com and trmnlp run it: a Node process with the payload on stdin, the
// file's code, then run(input), awaited. The function itself is tested by
// plugin/trmnl-com-polling/tests (trmnlp test, against fake APIs).
//
//   node transforms.mjs
//
// The payload is what TRMNL.com hands over after polling: several calendars as IDX_0,
// IDX_1, ... (each a list wrapped as { data: [...] }, seen on TRMNL.com 2026-10-03), one
// as `data`, and `trmnl` with the custom fields.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import worker from './sample-server/worker.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const code = fs.readFileSync(path.join(here, '..', 'plugin', 'trmnl-com-polling', 'transform.js'), 'utf8');

// as trmnlp's Node wrapper (lib/trmnlp/transform_backend/wrapper.rb) and TRMNL.com do it
// (async: the fake Home Assistant answers from this process)
function runTransform(input) {
  const script = `const input = JSON.parse(require('fs').readFileSync(0, 'utf8'));\n${code}\n`
    + 'Promise.resolve(run(input)).then((o) => process.stdout.write(JSON.stringify(o)));\n';
  const started = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['-e', script], { timeout: 10000 });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (status) => (status === 0 ? resolve({ output: JSON.parse(stdout), ms: Date.now() - started })
      : reject(new Error(`transform.js failed: ${stderr}`))));
    child.stdin.end(JSON.stringify(input));
  });
}

const failures = [];
const expect = (name, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `: ${detail}`}`);
  if (!ok) failures.push(name);
};

// the stand-in Home Assistant: the sample calendars as TRMNL.com polls them, then the forecast
const standIn = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const response = await worker.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers: req.headers,
    body: req.method === 'GET' ? undefined : Buffer.concat(chunks) }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
});
await new Promise((resolve) => standIn.listen(0, '127.0.0.1', resolve));
const standInUrl = `http://127.0.0.1:${standIn.address().port}`;
try {
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
  const poll = async (entity, token) => fetch(`${standInUrl}/api/calendars/${entity}?start=${day(0)}&end=${day(14)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  expect('the stand-in wants a token', (await poll('calendar.family')).status === 401, 'answered without one');
  const calendars = await Promise.all(['family', 'mark', 'sara'].map(async (name) => ({ data: await (await poll(`calendar.${name}`, 'any')).json() })));
  expect('the stand-in has the sample calendars', calendars.every((c) => Array.isArray(c.data) && c.data.length), JSON.stringify(calendars).slice(0, 200));
  const fields = { ha_url: standInUrl, ha_token: 'any', calendars: 'calendar.family,calendar.mark,calendar.sara', weather_entity: 'weather.forecast_home' };
  const out = (await runTransform({ IDX_0: calendars[0], IDX_1: calendars[1], IDX_2: calendars[2],
    trmnl: { plugin_settings: { custom_fields_values: fields } } })).output;
  expect('the stand-in gives transform.js a forecast', out.IDX_3?.service_response?.['weather.forecast_home']?.forecast?.length > 0,
    JSON.stringify(out.IDX_3));
} finally {
  standIn.close();
}

if (failures.length) process.exit(1);
