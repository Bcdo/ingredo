// Single source of truth for the app's theme. Plain CommonJS because
// tailwind.config.js requires it from Node, outside Metro's TS pipeline.
// Tailwind utilities resolve to the CSS variables produced by cssVars(),
// injected per color scheme at the root layout; components that need raw
// color values read the active palette via lib/usePalette. Swapping the
// values here (plus the font packages in app/_layout.tsx) re-themes the
// entire app.

// Translucent ink variants cover places NativeWind opacity classes can't
// reach: inkMuted (60%) for inactive tab tint, inkFaint (40%) for input
// placeholders.
function buildPalette(colors) {
  return { ...colors, inkMuted: `${colors.ink}99`, inkFaint: `${colors.ink}66` };
}

const light = buildPalette({
  cream: '#FBF7F1', // app background; also text on clay/sage surfaces
  linen: '#F3ECE1', // secondary surfaces, ghost buttons, borders
  clay: '#C96B45', // primary actions, active nav, quantities
  sage: '#7D9474', // confirmation, presence, plan→shop bridge
  sageDeep: '#50664A',
  butter: '#F3E2BE', // gentle status (offline, pending sync); ink text on top
  ink: '#3A322B', // text
});

// Experiment: Kveldsmat — the kitchen at 9pm. The warm palette inverted
// onto roasted-coffee surfaces: clay shifts amber, sage/sageDeep lighten
// for dark ground, butter darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#262019',
  linen: '#332B22',
  clay: '#DE8B5F',
  sage: '#93AE85',
  sageDeep: '#AFC79E',
  butter: '#8A6F3C',
  ink: '#F1E7D8',
});

const palettes = { light, dark };

function cssVars(palette) {
  return {
    '--color-cream': palette.cream,
    '--color-linen': palette.linen,
    '--color-clay': palette.clay,
    '--color-sage': palette.sage,
    '--color-sage-deep': palette.sageDeep,
    '--color-butter': palette.butter,
    '--color-ink': palette.ink,
  };
}

const fontFamilies = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  body: 'Karla_400Regular',
  bodyBold: 'Karla_700Bold',
};

module.exports = { palettes, cssVars, fontFamilies };
