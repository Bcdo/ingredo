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

// Experiment: Skjærgård — summer coast. Warm sand ground, clear
// sea-blue primary, seagrass secondary, driftwood ink. The warm
// counterpart to Nord's wintry blue.
const light = buildPalette({
  cream: '#FAF6ED', // app background; also text on clay/sage surfaces
  linen: '#F0E7D6', // secondary surfaces, ghost buttons, borders
  clay: '#2E7DA0', // primary actions, active nav, quantities
  sage: '#6F9884', // confirmation, presence, plan→shop bridge
  sageDeep: '#47685A',
  butter: '#F2E3C0', // gentle status (offline, pending sync); ink text on top
  ink: '#3B3A34', // text
});

// Dark counterpart: dusk over water. Blues and greens lighten for the
// navy ground; butter darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#16222D',
  linen: '#20303D',
  clay: '#63AECF',
  sage: '#8CB8A2',
  sageDeep: '#A6CDB9',
  butter: '#6B5F38',
  ink: '#E9E4D6',
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
