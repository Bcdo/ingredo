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

// Experiment: Rabarbra — Nordic summer instead of Nordic winter. Celery-
// white ground, raspberry/rhubarb primary (pink enough to never read as
// an error color), bright herb green, spruce-cast ink.
const light = buildPalette({
  cream: '#F6F8F2', // app background; also text on clay/sage surfaces
  linen: '#E9EFE0', // secondary surfaces, ghost buttons, borders
  clay: '#C2497B', // primary actions, active nav, quantities
  sage: '#6FA05C', // confirmation, presence, plan→shop bridge
  sageDeep: '#45703A',
  butter: '#F6E3AD', // gentle status (offline, pending sync); ink text on top
  ink: '#29352B', // text
});

// Dark counterpart: summer night in the garden. Raspberry and greens
// lighten for dark spruce ground; butter darkens so light ink stays
// readable on it.
const dark = buildPalette({
  cream: '#1E2620',
  linen: '#2A342C',
  clay: '#D9739E',
  sage: '#85B573',
  sageDeep: '#A9CB97',
  butter: '#7A6C3B',
  ink: '#EAF0E6',
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

// Rounded, jam-jar-label friendly: Baloo 2 display over Nunito Sans body.
// Loaded in app/_layout.tsx.
const fontFamilies = {
  display: 'Baloo2_600SemiBold',
  displayBold: 'Baloo2_700Bold',
  body: 'NunitoSans_400Regular',
  bodyBold: 'NunitoSans_700Bold',
};

module.exports = { palettes, cssVars, fontFamilies };
