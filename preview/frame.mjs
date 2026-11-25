// Puts a screenshot in TRMNL's device frame, for the README images (docs-images.sh).
//
//   node frame.mjs [--model og|x|frame] [--color white|black|sage|gray|wood|white-oak|cherry|sapele|walnut] <in.png> <out.png>
//
// (The Frame comes in its four woods only; any other colour gives white oak.)
//
// The frame is the bezel artwork from TRMNL's own <trmnl-frame> web component
// (github.com/usetrmnl/trmnl-component, MIT), pinned below by commit and SHA-256 and
// cached in out/. The component itself shows a live page in an iframe, dimmed
// (opacity 0.9) and scaled to fit; here only its SVG is used, with the screenshot laid
// into the screen at its own pixel size, so the README shows exactly what was rendered.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const here = path.dirname(fileURLToPath(import.meta.url));
const COMPONENT = {
  url: 'https://raw.githubusercontent.com/usetrmnl/trmnl-component/1f6f164f35d6475d8f41ea2999e6c00bca676f7c/trmnl-component.js',
  sha256: 'eaa79463d568379e0cb85c556a85d8fd5a0b514dcc0de5cdbe4cd9736ee8aaf8',
};
// The screen's shape in each model's SVG: a <use> of it is the first thing drawn on
// the screen, and the screenshot goes right after it, under the inner shadow. The Frame
// has a plain grey rect there, inside the moulding's 1280x720 window (its overlay), and
// the moulding is drawn over the window's edge: the screenshot fills the window.
const SCREEN = { og: '#path-4', x: '#x-screen', frame: { rect: 'rect[x="62"][y="62"]', x: 60, y: 60, width: 1280, height: 720 } };

const args = process.argv.slice(2);
const opts = { model: 'x', color: 'white' };
const files = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--model') opts.model = args[++i];
  else if (args[i] === '--color') opts.color = args[++i];
  else files.push(args[i]);
}
if (files.length !== 2 || !SCREEN[opts.model]) {
  console.error('usage: node frame.mjs [--model og|x|frame] [--color white|black|sage|gray|wood|white-oak|cherry|sapele|walnut] <in.png> <out.png>');
  process.exit(2);
}
const [input, output] = files;

const cached = path.join(here, 'out', 'trmnl-component.js');
const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');
if (!fs.existsSync(cached) || sha(fs.readFileSync(cached)) !== COMPONENT.sha256) {
  fs.mkdirSync(path.dirname(cached), { recursive: true });
  const js = execFileSync('curl', ['-sSfL', COMPONENT.url]);
  if (sha(js) !== COMPONENT.sha256) throw new Error(`${COMPONENT.url}: unexpected SHA-256 ${sha(js)}`);
  fs.writeFileSync(cached, js);
}

const png = fs.readFileSync(input);
const width = png.readUInt32BE(16);
const height = png.readUInt32BE(20);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const page = await browser.newPage({ deviceScaleFactor: 1 });
await page.route(/^https?:/, (route) => route.abort());
await page.setContent('<!doctype html><html><body style="margin:0"></body></html>');
// Through the DOM, not a <script> in the page: the component's source contains "</script>".
await page.addScriptTag({ content: fs.readFileSync(cached, 'utf8') });

const box = await page.evaluate(({ model, color, screen, href, width, height }) => {
  const el = document.createElement('trmnl-frame');
  el.setAttribute('model', model);
  el.setAttribute('color', color);
  document.body.append(el);
  const svg = el.shadowRoot.querySelector('svg').cloneNode(true);
  el.remove();
  document.body.append(svg);

  const NS = 'http://www.w3.org/2000/svg';
  const image = document.createElementNS(NS, 'image');
  let bb;
  if (typeof screen === 'string') {
    const shape = svg.querySelector(screen);
    const use = svg.querySelector(`use[*|href="${screen}"]`);
    bb = shape.getBBox();
    const clip = document.createElementNS(NS, 'clipPath');
    clip.id = 'screenshot-clip';
    clip.append(shape.cloneNode());
    clip.firstChild.removeAttribute('id');
    svg.querySelector('defs').append(clip);
    image.setAttribute('clip-path', 'url(#screenshot-clip)');
    use.after(image);
  } else {
    bb = screen;
    svg.querySelector(screen.rect).after(image);
  }
  for (const [k, v] of Object.entries({ x: bb.x, y: bb.y, width: bb.width, height: bb.height,
    preserveAspectRatio: 'none', href })) image.setAttribute(k, v);
  image.style.imageRendering = 'pixelated';

  // Scale the frame so the screen is the screenshot's size, and shift it by under a
  // pixel so the screen starts on a whole pixel: no resampling of the screenshot.
  const viewW = svg.viewBox.baseVal.width;
  const viewH = svg.viewBox.baseVal.height;
  const scale = width / bb.width;
  const r = image.getBoundingClientRect();
  const origin = { x: r.left / r.width * width, y: r.top / r.height * height };
  svg.setAttribute('width', viewW * scale);
  svg.setAttribute('height', viewH * scale);
  svg.style.cssText = `display:block; position:absolute; left:${Math.round(origin.x) - origin.x}px; top:${Math.round(origin.y) - origin.y}px`;
  if (Math.abs(height / bb.height - scale) > 0.01) throw new Error(`screenshot ${width}x${height} doesn't fit the ${model} screen`);
  return { x: 0, y: 0, width: Math.floor(viewW * scale), height: Math.floor(viewH * scale) };
}, { ...opts, screen: SCREEN[opts.model], href: `data:image/png;base64,${png.toString('base64')}`, width, height });

await page.setViewportSize({ width: box.width, height: box.height });
await page.screenshot({ path: output, clip: box, omitBackground: true });
await browser.close();
