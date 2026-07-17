const { palette, fontFamilies } = require('./lib/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        cream: palette.cream,
        linen: palette.linen,
        clay: palette.clay,
        sage: palette.sage,
        'sage-deep': palette.sageDeep,
        butter: palette.butter,
        ink: palette.ink,
      },
      borderRadius: {
        card: '20px',
      },
      fontFamily: {
        display: [fontFamilies.display],
        'display-bold': [fontFamilies.displayBold],
        body: [fontFamilies.body],
        'body-bold': [fontFamilies.bodyBold],
      },
    },
  },
  plugins: [],
};
