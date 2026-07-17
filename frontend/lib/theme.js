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

// Experiment: Rosemaling — traditional Norwegian folk-painting colors.
// Deep rosemaling blue as the primary, spruce green for confirmation,
// ochre for gentle status, warm brown-black ink on aged paper.
const light = buildPalette({
  cream: '#F6EFDF', // app background; also text on clay/sage surfaces
  linen: '#ECE0C8', // secondary surfaces, ghost buttons, borders
  clay: '#2F5D7C', // primary actions, active nav, quantities
  sage: '#4A6B4F', // confirmation, presence, plan→shop bridge
  sageDeep: '#35503A',
  butter: '#E8C87E', // gentle status (offline, pending sync); ink text on top
  ink: '#2E241C', // text
});

// Dark counterpart: painted timber at night. Blue and greens lighten for
// dark ground; ochre darkens so light ink stays readable on it.
const dark = buildPalette({
  cream: '#241D14',
  linen: '#322A1F',
  clay: '#7FA8CC',
  sage: '#8FAA7E',
  sageDeep: '#B3C9A4',
  butter: '#7A6230',
  ink: '#F0E7D3',
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

// Alegreya's bookish old-style warmth fits the folk register better than
// Fraunces' editorial polish. Loaded in app/_layout.tsx.
const fontFamilies = {
  display: 'Alegreya_600SemiBold',
  displayBold: 'Alegreya_700Bold',
  body: 'AlegreyaSans_400Regular',
  bodyBold: 'AlegreyaSans_700Bold',
};

module.exports = { palettes, cssVars, fontFamilies };
