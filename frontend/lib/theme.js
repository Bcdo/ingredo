// Single source of truth for the app's theme. Plain CommonJS because
// tailwind.config.js requires it from Node, outside Metro's TS pipeline.
// Swapping the values here (plus the font packages in app/_layout.tsx)
// re-themes the entire app.

const palette = {
  cream: '#FBF7F1', // app background
  linen: '#F3ECE1', // secondary surfaces, ghost buttons, borders
  clay: '#C96B45', // primary actions, active nav, quantities
  sage: '#7D9474', // confirmation, presence, plan→shop bridge
  sageDeep: '#50664A',
  butter: '#F3E2BE', // gentle status (offline, pending sync)
  ink: '#3A322B', // text
};

// Translucent ink for places NativeWind opacity classes can't reach.
const inkMuted = `${palette.ink}99`; // 60% — inactive tab tint
const inkFaint = `${palette.ink}66`; // 40% — input placeholders

const fontFamilies = {
  display: 'Fraunces_600SemiBold',
  displayBold: 'Fraunces_700Bold',
  body: 'Karla_400Regular',
  bodyBold: 'Karla_700Bold',
};

module.exports = { palette, inkMuted, inkFaint, fontFamilies };
