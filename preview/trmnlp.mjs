// Renders plugin/src with trmnlp, TRMNL's own preview tool (Ruby Liquid, as on TRMNL and
// Terminus), and writes the markup of one view (full by default, or a half inside trmnlp's
// mashup, or the quadrant) for render.mjs --body to screenshot.
//
//   node trmnlp.mjs <context.json> <body.html> [full|half_horizontal|half_vertical|quadrant]
//                                                   (context from render.mjs --dump-context)
//   TRMNLP_VARIANT=trmnl-com-merge node trmnlp.mjs ...    a variant in plugin/ instead, put
//                                                   together as
//                                                   scripts/build-variant.sh does
//   TRMNLP_PNG=<file> node trmnlp.mjs ...           also trmnlp's own PNG (see png() below)
//   node trmnlp.mjs --pull                          only fetches the image, if missing
//   node trmnlp.mjs --lint                          runs `trmnlp lint` (see lint() below)
//
// Needs Docker (the trmnl/trmnlp image). The context's custom fields and payload go into
// .trmnlp.yml, so trmnlp hands the payload over the TRMNL way: its keys at the top level,
// several calendars as IDX_0, IDX_1, ... and no `data`. trmnlp's own polling can't reach
// the sample URLs and is left to fail (it only warns). The screenshot is render.mjs's, with
// the framework served locally, so it compares with the other renders; TRMNLP_PNG adds
// trmnlp's own, which loads the framework from trmnl.com.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const IMAGE = 'trmnl/trmnlp:v0.16.0';
// Rule IDs (as `trmnlp lint` prints them, e.g. no_opacity) of findings that don't apply
// here, each with why. Empty since trmnlp 0.15.0 counts only real style attributes in its
// inline-styles check (it used to count CSS words in shared.liquid's stylesheet).
const LINT_ALLOWED = [];

const here = path.dirname(fileURLToPath(import.meta.url));
// Our user in the container. One the image doesn't know (CI's) has HOME=/, which it can't
// write: trmnlp then can't keep the transform's output for the render (no events), and
// Firefox never starts (Net::ReadTimeout)
const user = ['--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp'];
const [contextFile, bodyFile, size = 'full'] = process.argv.slice(2);
if (contextFile === '--pull') {
  try {
    execFileSync('docker', ['image', 'inspect', IMAGE], { stdio: 'ignore' });
  } catch {
    execFileSync('docker', ['pull', '--quiet', IMAGE], { stdio: 'inherit' });
  }
  process.exit(0);
}
if (contextFile === '--lint') process.exit(lint() ? 0 : 1);
if (!contextFile || !bodyFile) throw new Error('usage: node trmnlp.mjs <context.json> <body.html> [size]');

const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
// Plugin Merge (render.mjs --merge) has no polled `data`: the chosen plugins' data is at the top level
const { size: _size, config: _config, trmnl: _trmnl, ...merged } = context;
const payload = 'data' in context ? context.data : merged;
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnlp-'));
const plugin = path.join(here, '..', 'plugin');
const variant = process.env.TRMNLP_VARIANT;
fs.cpSync(path.join(plugin, 'src'), path.join(project, 'src'), { recursive: true });
if (variant) {
  // a variant: its settings, and its own Liquid in front of the shared markup
  const own = fs.readdirSync(path.join(plugin, variant)).filter((f) => f.endsWith('.liquid')).sort();
  fs.copyFileSync(path.join(plugin, variant, 'settings.yml'), path.join(project, 'src', 'settings.yml'));
  fs.writeFileSync(path.join(project, 'src', 'shared.liquid'),
    own.map((f) => fs.readFileSync(path.join(plugin, variant, f), 'utf8')).join('')
    + fs.readFileSync(path.join(plugin, 'src', 'shared.liquid'), 'utf8'));  // its serverless function, which trmnlp runs on the payload as TRMNL.com does
  for (const f of fs.readdirSync(path.join(plugin, variant)).filter((f) => /^transform\.\w+$/.test(f))) {
    fs.copyFileSync(path.join(plugin, variant, f), path.join(project, 'src', f));
  }
}
fs.writeFileSync(path.join(project, '.trmnlp.yml'), yaml.dump({
  watch: false,
  time_zone: context.trmnl.user.time_zone_iana,
  custom_fields: context.config,
  variables: Array.isArray(payload) ? { data: payload } : payload,
}));

execFileSync('docker', ['run', '--rm', ...user,
  '--volume', `${project}:/plugin`, IMAGE, 'build'], { stdio: 'inherit' });

// The view as trmnlp renders it: everything inside <div class="screen">
const html = fs.readFileSync(path.join(project, '_build', `${size}.html`), 'utf8');
// (screen--no-bleed and the like with no_screen_padding, as on TRMNL.com)
const open = html.match(/<div class="screen(?: [^"]*)?">/);
const start = open ? open.index + open[0].length : -1;
const end = html.lastIndexOf('</div>', html.lastIndexOf('</body>'));
if (start < 0 || end < start) throw new Error('unexpected trmnlp output');
fs.writeFileSync(bodyFile, html.slice(start, end));
if (process.env.TRMNLP_PNG) await png(process.env.TRMNLP_PNG);
fs.rmSync(project, { recursive: true, force: true });

// TRMNLP_PNG=<file>: also trmnlp's own PNG of the view, a TRMNL X at TRMNL.com's default
// (regular) scale, from `trmnlp serve`, which renders as TRMNL's converter does (Framework
// from trmnl.com, FullCalendar from jsDelivr, TRMNL's ready signals and grey levels).
// `trmnlp build --png` can't: it renders only the default 800x480 screen.
async function png(file) {
  const run = (...a) => execFileSync('docker', a, { encoding: 'utf8' }).trim();
  // TRMNLP_DOCKER_ARGS: extra `docker run` options, e.g. --network=host behind a proxy
  const extra = (process.env.TRMNLP_DOCKER_ARGS || '').split(' ').filter(Boolean);
  const port = await freePort();
  const id = run('run', '--detach', '--rm', ...user, ...extra,
    ...(extra.includes('--network=host') ? [] : ['--publish', `127.0.0.1:${port}:${port}`]),
    '--volume', `${project}:/plugin`, IMAGE, 'serve', '--port', String(port));
  try {
    const base = `http://127.0.0.1:${port}`;
    const params = new URLSearchParams({ screen_classes: 'screen screen--4bit screen--v2 screen--lg',
      width: 1872, height: 1404, color_depth: 4, model: 'v2', bit_depth: 4 });
    let response;
    for (let tries = 0; ; tries++) {
      try { response = await fetch(`${base}/render/${size}.png?${params}`); break; } catch (error) {
        if (tries > 60) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    if (!response.ok) throw new Error(`trmnlp PNG: ${response.status} ${(await response.text()).slice(0, 2000)}`);
    const image = Buffer.from(await response.arrayBuffer());
    fs.writeFileSync(file, image);
    // A blank screen (the Framework or FullCalendar didn't load) compresses to about 1 kB,
    // a calendar to well over 20 kB
    if (image.length < 20000) throw new Error(`trmnlp PNG ${file} looks blank (${image.length} bytes)`);
  } finally {
    try { run('stop', id); } catch { /* already gone */ }
  }
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer().once('error', reject).listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

// `trmnlp lint` (TRMNL's best-practice checks) on plugin/src (LaraPaper, polling) and on
// every variant as scripts/build-variant.sh builds it (e.g. TRMNL.com: merge.liquid in front
// of the shared markup, its own settings). Every custom field gets a value, so the
// unused-field check covers them all. Fails on any finding not in LINT_ALLOWED.
function lint() {
  const repo = path.join(here, '..');
  const built = execFileSync('sh', [path.join(repo, 'scripts', 'build-variant.sh')], { encoding: 'utf8' });
  const projects = { larapaper: path.join(repo, 'plugin', 'src') };
  for (const [, name] of built.matchAll(/^wrote dist\/([^/]+)\/src /gm)) projects[name] = path.join(repo, 'dist', name, 'src');
  let ok = true;
  for (const [name, src] of Object.entries(projects)) {
    const fields = yaml.load(fs.readFileSync(path.join(src, 'settings.yml'), 'utf8')).custom_fields;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnlp-lint-'));
    fs.cpSync(src, path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.trmnlp.yml'), yaml.dump({
      watch: false,
      custom_fields: Object.fromEntries(fields.filter((field) => field.field_type !== 'author_bio')
        .map((field) => [field.keyname, String(field.default ?? 'x')])),
    }));
    const run = spawnSync('docker', ['run', '--rm', ...user,
      '--volume', `${dir}:/plugin`, IMAGE, 'lint', '--format', 'json'], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    let report = null;
    try { report = JSON.parse(run.stdout); } catch { /* trmnlp itself failed (settings, Docker, ...) */ }
    const unexpected = report?.issues.filter((issue) => !LINT_ALLOWED.includes(issue.rule_id));
    if (!report || unexpected.length) {
      ok = false;
      const where = (issue) => issue.locations.map((l) => `\n     ${l.path}:${l.line}:${l.column}`).join('');
      const findings = unexpected?.map((issue) => `\n  [${issue.rule_id}] ${issue.message}${where(issue)}`).join('');
      console.log(`${name}: FAILED${findings || `\n${run.stdout ?? ''}${run.stderr ?? ''}${run.error ?? ''}`}`);
    } else {
      const allowed = report.issues.map((issue) => issue.rule_id);
      console.log(`${name}: ok${allowed.length ? ` (allowed: ${allowed.join(', ')})` : ''}`);
    }
  }
  return ok;
}
