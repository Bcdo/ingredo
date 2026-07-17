const { fontFamilies } = require('./lib/theme');

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        cream: 'var(--color-cream)',
        linen: 'var(--color-linen)',
        clay: 'var(--color-clay)',
        sage: 'var(--color-sage)',
        'sage-deep': 'var(--color-sage-deep)',
        butter: 'var(--color-butter)',
        ink: 'var(--color-ink)',
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
