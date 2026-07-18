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

// Experiment: Nord Aurora — the Nord mapping with the primary shifted from
// Frost blue to Aurora berry/orange, probing a warmer accent on the same
// arctic surfaces. sageDeep is a darkened nord14 — Nord ships no deep
// green of its own. Caveat consciously probed: the design system reserves
// red for nothing (never-red rule is about errors); nord11 is berry, not
// alarm red — judge on device.
const light = buildPalette({
  cream: '#ECEFF4', // app background (nord6, Snow Storm)
  linen: '#E5E9F0', // secondary surfaces, ghost buttons, borders (nord5)
  clay: '#BF616A', // primary actions, active nav, quantities (nord11, Aurora)
  sage: '#A3BE8C', // confirmation, presence, plan→shop bridge (nord14, Aurora)
  sageDeep: '#728562',
  butter: '#EBCB8B', // gentle status (offline, pending sync) (nord13, Aurora)
  ink: '#2E3440', // text (nord0, Polar Night)
});

// Dark: Polar Night ground with the Aurora orange as primary (nord12 —
// lighter than nord11, keeps dark text readable on it). sageDeep lightens
// and butter darkens (both derived — light ink must stay readable on
// butter chips).
const dark = buildPalette({
  cream: '#2E3440', // nord0
  linen: '#3B4252', // nord1
  clay: '#D08770', // nord12, Aurora
  sage: '#A3BE8C', // nord14
  sageDeep: '#B5CBA1',
  butter: '#766537',
  ink: '#ECEFF4', // nord6
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
