import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/target/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Plain Node scripts (not TypeScript) need the Node globals declared.
    files: ['**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', fetch: 'readonly', URL: 'readonly', console: 'readonly' } },
  },
);
