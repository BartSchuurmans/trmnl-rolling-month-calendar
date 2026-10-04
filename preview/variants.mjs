// Keeps the recipe's variants in step with plugin/src (see plugin/README.md). A variant is a
// folder in plugin/ with its own settings.yml (and Liquid put in front of the shared
// markup), built by scripts/build-variant.sh.
//
//   node variants.mjs check                  every variant's settings.yml against
//                                            plugin/src/settings.yml: the settings both have
//                                            must match (type, name, group, options,
//                                            default, order), and every setting of
//                                            plugin/src must be in the variant too, unless
//                                            VARIANTS says why not.
//                                            Run by ci.sh.
//   node variants.mjs diff <variant> <dir>   a trmnlp project pulled from TRMNL.com
//                                            (`trmnlp pull`) against dist/<variant>/src:
//                                            markup, serverless function, form fields and
//                                            the settings we set
//                                            (bar the encrypted ones TRMNL keeps back).
//                                            Run by .github/workflows/trmnl-com.yml.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as yaml from 'js-yaml';

// Per variant: the plugin/src settings it leaves out (and why), the settings only it has,
// and (optional) properties of shared settings it sets its own way (and why)
const VARIANTS = {
  'trmnl-com-merge': {
    leftOut: {
      ics_urls: 'TRMNL.com polls JSON only; an .ics feed fails as "Malformed JSON"',
      ha_url: 'Home Assistant would have to be reachable from the internet',
      ha_token: 'Home Assistant would have to be reachable from the internet',
      calendars: 'Home Assistant entities; replaced by the calendar_N dropdowns',
      weather_entity: 'needs the LaraPaper (local) app\'s Home Assistant proxy; replaced by the weather_plugin dropdown',
    },
    own: /^(calendar_\d+|weather_plugin)$/,
    differs: {
      name: 'its own recipe on TRMNL.com, named after its data source (TRMNL\'s calendar plugins)',
    },
  },
  'trmnl-com-polling': {
    leftOut: {
      ics_urls: 'TRMNL.com polls JSON only; an .ics feed fails as "Malformed JSON"',
    },
    own: /^$/,
    differs: {
      name: 'its own recipe on TRMNL.com, named after its data source',
      'ha_url.default': 'the default is the LaraPaper (local) app\'s proxy; TRMNL.com needs the public URL',
      'ha_url.optional': 'Home Assistant is the only source here',
      'ha_token.optional': 'TRMNL.com reaches Home Assistant from the internet, always with a token',
      'calendars.optional': 'Home Assistant is the only source here',
    },
  },
};
// Differ on purpose: each About describes its own data sources
const OWN_TEXT = ['about'];
// Top-level settings every variant runs with
const SHARED_SETTINGS = ['name', 'refresh_interval', 'framework_version'];
// Settings TRMNL keeps encrypted, which `trmnlp pull` doesn't return
const SECRET_SETTINGS = ['polling_headers', 'polling_body'];

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const load = (file) => yaml.load(fs.readFileSync(file, 'utf8'));
const errors = [];
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const [command, ...rest] = process.argv.slice(2);
if (command === 'check') check();
else if (command === 'diff' && rest.length === 2) diff(...rest);
else throw new Error('usage: node variants.mjs check | diff <variant> <pulled trmnlp project>');

if (errors.length) {
  console.log(errors.map((e) => `- ${e}`).join('\n'));
  process.exit(1);
}

function check() {
  const src = load(path.join(root, 'plugin/src/settings.yml'));
  const srcFields = new Map(src.custom_fields.map((f) => [f.keyname, f]));
  const variants = fs.readdirSync(path.join(root, 'plugin'))
    .filter((name) => name !== 'src' && fs.existsSync(path.join(root, 'plugin', name, 'settings.yml')));
  for (const name of variants) {
    const rules = VARIANTS[name];
    if (!rules) {
      errors.push(`plugin/${name}: add it to VARIANTS in preview/variants.mjs`);
      continue;
    }
    const variant = load(path.join(root, 'plugin', name, 'settings.yml'));
    const at = `plugin/${name}/settings.yml`;
    const differs = rules.differs || {};
    for (const key of SHARED_SETTINGS) {
      if (differs[key]) continue;
      if (!same(src[key], variant[key])) errors.push(`${key}: ${src[key]} in plugin/src, ${variant[key]} in ${at}`);
    }
    const fields = new Map(variant.custom_fields.map((f) => [f.keyname, f]));
    for (const key of srcFields.keys()) {
      if (!fields.has(key) && !rules.leftOut[key]) {
        errors.push(`${key}: in plugin/src/settings.yml but not ${at} (add it there, or to its leftOut in preview/variants.mjs)`);
      }
    }
    for (const [key, field] of fields) {
      const other = srcFields.get(key);
      if (!other) {
        if (!rules.own.test(key)) errors.push(`${key}: only in ${at}`);
        continue;
      }
      if (rules.leftOut[key]) errors.push(`${key}: in ${at}, but its leftOut says ${rules.leftOut[key]}`);
      const props = OWN_TEXT.includes(key) ? ['field_type'] : ['field_type', 'name', 'group', 'options', 'default', 'optional'];
      for (const prop of props) {
        if (differs[`${key}.${prop}`]) continue;
        // a boolean's default may be text ('true') in a variant (see plugin/trmnl-com-merge/settings.yml)
        const text = (v) => (prop === 'default' && field.field_type === 'boolean' && typeof v === 'boolean' ? String(v) : v);
        if (!same(text(field[prop]), text(other[prop]))) {
          errors.push(`${key}.${prop}: ${JSON.stringify(other[prop])} in plugin/src, ${JSON.stringify(field[prop])} in ${at}`);
        }
      }
    }
    const order = (list) => list.map((f) => f.keyname).filter((k) => srcFields.has(k) && fields.has(k));
    if (!same(order(src.custom_fields), order(variant.custom_fields))) {
      errors.push(`${at}: form fields in a different order than plugin/src: ${order(variant.custom_fields)}`);
    }
  }
  console.log(errors.length ? 'variants: FAILED' : `variants: ok (${variants.join(', ')})`);
}

function diff(variant, pulled) {
  const built = path.join(root, 'dist', variant, 'src');
  // the markup, and the serverless function (transform.js) if the variant has one
  for (const file of fs.readdirSync(built).filter((f) => f.endsWith('.liquid') || /^transform\.\w+$/.test(f))) {
    const ours = fs.readFileSync(path.join(built, file), 'utf8');
    const theirs = path.join(pulled, file);
    // TRMNL stores markup with CRLF line ends when it was edited in the browser
    const live = fs.existsSync(theirs) ? fs.readFileSync(theirs, 'utf8').replace(/\r\n/g, '\n') : null;
    if (live === null) errors.push(`${file}: missing on TRMNL.com`);
    else if (live.trimEnd() !== ours.trimEnd()) errors.push(`${file}: differs (${firstDifference(live, ours)})`);
  }
  const ours = load(path.join(built, 'settings.yml'));
  const live = load(path.join(pulled, 'settings.yml')) || {};
  // TRMNL keeps multi-line text settings with CRLF line ends too
  const text = (value) => String(value ?? '').replace(/\r\n/g, '\n').trimEnd();
  for (const key of Object.keys(ours).filter((k) => k !== 'custom_fields')) {
    // TRMNL stores polling headers and body encrypted and `trmnlp pull` leaves them out
    // (null); the plugin's own page only says "[set]", so they can't be compared
    if (SECRET_SETTINGS.includes(key) && live[key] == null) continue;
    if (text(ours[key]) !== text(live[key])) errors.push(`settings ${key}: ${JSON.stringify(live[key])} on TRMNL.com, ${JSON.stringify(ours[key])} here`);
  }
  if (!same(live.custom_fields, ours.custom_fields)) {
    const liveFields = new Map((live.custom_fields || []).map((f) => [f.keyname, f]));
    const changed = ours.custom_fields.filter((f) => !same(f, liveFields.get(f.keyname))).map((f) => f.keyname);
    const extra = [...liveFields.keys()].filter((k) => !ours.custom_fields.some((f) => f.keyname === k));
    errors.push(`form fields differ: ${[...changed, ...extra.map((k) => `${k} (only on TRMNL.com)`)].join(', ') || 'order'}`);
  }
  console.log(errors.length ? 'TRMNL.com differs from the repo:' : 'TRMNL.com matches the repo');
}

function firstDifference(a, b) {
  const la = a.split('\n'), lb = b.split('\n');
  const i = la.findIndex((line, n) => line !== lb[n]);
  const n = i < 0 ? Math.min(la.length, lb.length) : i;
  return `from line ${n + 1}: TRMNL.com ${JSON.stringify((la[n] ?? '').trim().slice(0, 80))}, repo ${JSON.stringify((lb[n] ?? '').trim().slice(0, 80))}`;
}
