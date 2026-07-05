/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,ts,tsx}', './components/**/*.{js,ts,tsx}'],

  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        cream: '#FBF7F1',
        linen: '#F3ECE1',
        clay: '#C96B45',
        sage: '#7D9474',
        'sage-deep': '#50664A',
        butter: '#F3E2BE',
        ink: '#3A322B',
      },
      borderRadius: {
        card: '20px',
      },
      fontFamily: {
        display: ['Fraunces_600SemiBold'],
        'display-bold': ['Fraunces_700Bold'],
        body: ['Karla_400Regular'],
        'body-bold': ['Karla_700Bold'],
      },
    },
  },
  plugins: [],
};
