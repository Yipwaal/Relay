const tseslint = require('@typescript-eslint/eslint-plugin');
const tsParser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      '@typescript-eslint/no-unused-vars': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',
    },
  },
  {
    // Renderer-bestanden zijn import-vrije classic scripts die via <script>
    // top-level functies met elkaar delen (zie index.html) — per bestand lijken
    // die ongebruikt. Lokale variabelen blijven wél gecontroleerd.
    files: ['src/renderer/**/*.ts'],
    languageOptions: {
      sourceType: 'script',
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { vars: 'local' }],
    },
  },
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
];
