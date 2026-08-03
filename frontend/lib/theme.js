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

// Dark mirrors light on this branch: the default theme has no dark look
// yet, so dark-scheme devices keep today's appearance. Theme experiment
// branches override this palette.
const dark = light;

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

// Experiment: font isolation for the poll — Baloo 2 over Nunito Sans
// (rabarbra's typefaces) on the default palette, so the font vote is
// not confounded with colours. Loaded in app/_layout.tsx.
const fontFamilies = {
  display: 'Baloo2_600SemiBold',
  displayBold: 'Baloo2_700Bold',
  body: 'NunitoSans_400Regular',
  bodyBold: 'NunitoSans_700Bold',
};

module.exports = { palettes, cssVars, fontFamilies };
