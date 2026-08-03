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

// Experiment: Skifer — the quiet end of the poll. Warm paper, slate
// greys, and a single burnt-saffron accent for primary actions. Tests
// whether people want less colour, not more.
const light = buildPalette({
  cream: '#FAF8F4', // app background; also text on clay/sage surfaces
  linen: '#ECE9E2', // secondary surfaces, ghost buttons, borders
  clay: '#A87908', // primary actions, active nav, quantities
  sage: '#6E7674', // confirmation, presence, plan→shop bridge
  sageDeep: '#474E4C',
  butter: '#F1E8CF', // gentle status (offline, pending sync); ink text on top
  ink: '#26282B', // text
});

// Dark counterpart: slate black. Saffron and greys lighten for the
// dark ground; butter darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#1B1D20',
  linen: '#26292E',
  clay: '#E3B84F',
  sage: '#A6ADAA',
  sageDeep: '#C2C9C6',
  butter: '#564F35',
  ink: '#EFEDE8',
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
