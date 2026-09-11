const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*', '.expo/*'],
  },
  {
    rules: {
      'react/display-name': 'off',
      // React Compiler rule, new in eslint-config-expo 56. The two hits are
      // deliberate "reset local state when a dependency changes" effects
      // (root migrations retry, households on session change); keep them
      // visible as warnings until those are restructured.
      'react-hooks/set-state-in-effect': 'warn',
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
