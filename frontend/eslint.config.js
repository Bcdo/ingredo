/* eslint-env node */
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    rules: {
      'react/display-name': 'off',
    },
  },
  {
    files: ['jest.setup.js', '**/__tests__/**/*.{js,jsx,ts,tsx}', '**/*.test.{js,jsx,ts,tsx}'],
    languageOptions: {
      globals: {
        jest: 'readonly',
      },
    },
  },
]);
