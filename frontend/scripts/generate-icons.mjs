// One-shot asset generator: node scripts/generate-icons.mjs
// Renders the Ingredo lettermark (spec 2026-08-02, icon A2) into the
// committed PNG assets. Uses the app's own Fraunces SemiBold so no
// system font is involved.
import { Resvg } from '@resvg/resvg-js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const fontFile = join(
  root,
  '../node_modules/@expo-google-fonts/fraunces/600SemiBold/Fraunces_600SemiBold.ttf'
);

// The A2 mark in a 100×100 box: clay dotless-ı, sage leaf as the dot.
const MARK = `
  <text x="50" y="78" font-family="Fraunces" font-weight="600" font-size="76" fill="#C96B45" text-anchor="middle">&#305;</text>
  <path d="M44 31 Q42 12 62 8 Q66 27 50 33 Q45 34 44 31 Z" fill="#7D9474"/>
  <path d="M46 30 Q52 22 59 13" stroke="#50664A" stroke-width="1.6" fill="none" stroke-linecap="round"/>`;

const svg = (body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 100 100">${body}</svg>`;

const targets = {
  // Full-bleed launcher icon (iOS + legacy Android): cream ground.
  'icon.png': svg(`<rect width="100" height="100" fill="#FBF7F1"/>${MARK}`),
  // Android adaptive foreground: transparent, mark scaled into the
  // central safe zone (adaptive icons are cropped to circles/squircles).
  'adaptive-icon.png': svg(
    `<g transform="translate(50 50) scale(0.62) translate(-50 -50)">${MARK}</g>`
  ),
  // Splash image: transparent, modest mark — splash.backgroundColor
  // (cream, set in app.config.ts) fills the rest of the screen.
  'splash.png': svg(
    `<g transform="translate(50 50) scale(0.46) translate(-50 -50)">${MARK}</g>`
  ),
};

for (const [name, source] of Object.entries(targets)) {
  const png = new Resvg(source, {
    fitTo: { mode: 'width', value: 1024 },
    font: { fontFiles: [fontFile], loadSystemFonts: false, defaultFontFamily: 'Fraunces' },
  })
    .render()
    .asPng();
  writeFileSync(join(root, '../assets', name), png);
  console.log(`wrote assets/${name} (${png.length} bytes)`);
}
