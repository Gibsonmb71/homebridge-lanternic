import js from '@eslint/js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import tseslint from 'typescript-eslint';

const configDir = dirname(fileURLToPath(import.meta.url));

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist',
      '.test-dist',
      'coverage',
    ],
  },
  {
    files: [
      '**/*.ts',
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: configDir,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: [
      '**/*.mjs',
    ],
    languageOptions: {
      globals: {
        Buffer: 'readonly',
        clearTimeout: 'readonly',
        console: 'readonly',
        process: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    files: [
      'tools/calibrator/**/*.js',
    ],
    languageOptions: {
      globals: {
        Blob: 'readonly',
        URL: 'readonly',
        clearTimeout: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        localStorage: 'readonly',
        navigator: 'readonly',
        setTimeout: 'readonly',
        window: 'readonly',
      },
    },
  },
);
