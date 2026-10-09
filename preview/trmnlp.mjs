// Renders plugin/src with trmnlp, TRMNL's own preview tool (Ruby Liquid, as on TRMNL and
// Terminus), and writes the markup of one view (full by default, or a half inside trmnlp's
// mashup, or the quadrant) for render.mjs --body to screenshot.
//
//   node trmnlp.mjs <context.json> <body.html> [full|half_horizontal|half_vertical|quadrant]
//                                                   (context from render.mjs --dump-context)
//   node trmnlp.mjs --pull                          only fetches the image, if missing
//   node trmnlp.mjs --lint                          runs `trmnlp lint` (see lint() below)
//   node trmnlp.mjs --test <merge-context.json> <report dir>
//                                                   runs every variant's tests (see test() below)
//
// Needs Docker (the trmnl/trmnlp image). The context's custom fields and payload go into
// .trmnlp.yml, so trmnlp hands the payload over the TRMNL way: its keys at the top level,
// several calendars as IDX_0, IDX_1, ... and no `data`; trmnlp doesn't poll. The screenshot
// is render.mjs's, with the framework served locally, so it compares with the other renders.
// The TRMNL.com variants are rendered by their own tests instead (--test), with trmnlp's own
// screens.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

const IMAGE = 'trmnl/trmnlp:v0.24.0';
// Rule IDs (as `trmnlp lint` prints them, e.g. no_opacity) of findings that don't apply
// here, each with why; trmnlp skips them (`ignored_lint_rules`, 0.20.0). Empty since trmnlp
// 0.15.0 counts only real style attributes in its inline-styles check (it used to count CSS
// words in shared.liquid's stylesheet).
const LINT_ALLOWED = [];

const here = path.dirname(fileURLToPath(import.meta.url));
// Our user in the container. One the image doesn't know (CI's) has HOME=/, which it can't
// write: trmnlp then can't keep the transform's output for the render (no events), and
// Firefox never starts (Net::ReadTimeout)
// No daily "newer trmnlp" notice (0.21.0): the image is pinned on purpose, and
// scripts/check-upstream.sh watches for releases
const user = ['--user', `${process.getuid()}:${process.getgid()}`, '--env', 'HOME=/tmp',
  '--env', 'TRMNLP_NO_UPDATE_NOTIFIER=1'];
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
if (contextFile === '--test') process.exit(test(bodyFile, size) ? 0 : 1);
if (!contextFile || !bodyFile) throw new Error('usage: node trmnlp.mjs <context.json> <body.html> [size]');

const context = JSON.parse(fs.readFileSync(contextFile, 'utf8'));
const payload = context.data;
const project = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnlp-'));
fs.cpSync(path.join(here, '..', 'plugin', 'src'), path.join(project, 'src'), { recursive: true });
// No polling: the payload comes from .trmnlp.yml, and the recipe's URLs (LaraPaper's local
// Home Assistant proxy, the sample feeds) can't be reached here. Without a polling url trmnlp
// (0.17.0 on) renders with the variables only, instead of warning about each URL
const settingsFile = path.join(project, 'src', 'settings.yml');
const settings = yaml.load(fs.readFileSync(settingsFile, 'utf8'));
delete settings.polling_url;
fs.writeFileSync(settingsFile, yaml.dump(settings));
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
fs.rmSync(project, { recursive: true, force: true });

// `trmnlp test`: each variant's RSpec files (plugin/<variant>/tests/*_spec.rb) on the variant
// as scripts/build-variant.sh builds it, through trmnlp's own pipeline: polling and the
// serverless function against fake APIs, every clock at a fixed time, and the views drawn by
// Firefox on TRMNL's devices. Next to the tests: docs/sample-ha's calendars (sample-ha/) and
// the Plugin Merge render context (context.json, from render.mjs --dump-context). Writes
// trmnlp's report (index.html, every screen drawn) to <report dir>/<variant>; under GitHub
// Actions the counts and failures also go to the run's summary.
function test(mergeContext, reportDir) {
  if (!mergeContext || !reportDir) throw new Error('usage: node trmnlp.mjs --test <merge-context.json> <report dir>');
  const repo = path.join(here, '..');
  execFileSync('sh', [path.join(repo, 'scripts', 'build-variant.sh')], { stdio: 'ignore' });
  const extra = (process.env.TRMNLP_DOCKER_ARGS || '').split(' ').filter(Boolean);
  const summary = process.env.GITHUB_STEP_SUMMARY;
  let ok = true;
  for (const variant of fs.readdirSync(path.join(repo, 'plugin')).sort()) {
    const tests = path.join(repo, 'plugin', variant, 'tests');
    if (variant === 'src' || !fs.existsSync(tests)) continue;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trmnlp-test-'));
    fs.cpSync(path.join(repo, 'dist', variant, 'src'), path.join(dir, 'src'), { recursive: true });
    fs.cpSync(tests, path.join(dir, 'tests'), { recursive: true });
    fs.cpSync(path.join(repo, 'docs', 'sample-ha', 'api', 'calendars'), path.join(dir, 'tests', 'sample-ha'), { recursive: true });
    fs.copyFileSync(mergeContext, path.join(dir, 'tests', 'context.json'));
    fs.writeFileSync(path.join(dir, '.trmnlp.yml'), yaml.dump({ watch: false, time_zone: 'Europe/Amsterdam' }));
    const run = spawnSync('docker', ['run', '--rm', ...user, ...extra, '--volume', `${dir}:/plugin`,
      ...(summary ? ['--env', 'CI=true', '--env', 'GITHUB_STEP_SUMMARY=/summary.md', '--volume', `${summary}:/summary.md`] : []),
      IMAGE, 'test', '--report', 'report'], { encoding: 'utf8' });
    const report = path.join(reportDir, variant);
    fs.rmSync(report, { recursive: true, force: true });
    if (fs.existsSync(path.join(dir, 'report'))) fs.cpSync(path.join(dir, 'report'), report, { recursive: true });
    fs.rmSync(dir, { recursive: true, force: true });
    // RSpec's own output, without Selenium's log lines
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.split('\n').filter((l) => !/selenium/i.test(l)).join('\n').trim();
    if (run.status !== 0) ok = false;
    console.log(`${variant}: ${run.status === 0 ? 'ok' : 'FAILED'} (report: ${path.relative(process.cwd(), report)})\n${output}`);
  }
  return ok;
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
      ignored_lint_rules: LINT_ALLOWED,
      custom_fields: Object.fromEntries(fields.filter((field) => field.field_type !== 'author_bio')
        .map((field) => [field.keyname, String(field.default ?? 'x')])),
    }));
    const run = spawnSync('docker', ['run', '--rm', ...user,
      '--volume', `${dir}:/plugin`, IMAGE, 'lint', '--format', 'json'], { encoding: 'utf8' });
    fs.rmSync(dir, { recursive: true, force: true });
    let report = null;
    try { report = JSON.parse(run.stdout); } catch { /* trmnlp itself failed (settings, Docker, ...) */ }
    if (!report || report.issues.length) {
      ok = false;
      const where = (issue) => issue.locations.map((l) => `\n     ${l.path}:${l.line}:${l.column}`).join('');
      const findings = report?.issues.map((issue) => `\n  [${issue.rule_id}] ${issue.message}${where(issue)}`).join('');
      console.log(`${name}: FAILED${findings || `\n${run.stdout ?? ''}${run.stderr ?? ''}${run.error ?? ''}`}`);
    } else {
      console.log(`${name}: ok`);
    }
  }
  return ok;
}
