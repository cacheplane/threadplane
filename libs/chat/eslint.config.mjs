import nx from '@nx/eslint-plugin';
import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          // scripts/ holds CI tooling (the devtools bundle check) that never ships.
          ignoredFiles: ['{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}', '{projectRoot}/scripts/**'],
          ignoredDependencies: ['vite', '@nx/vite', 'vitest', '@analogjs/vite-plugin-angular'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
  ...nx.configs['flat/angular'],
  ...nx.configs['flat/angular-template'],
  {
    files: ['**/*.ts'],
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: ['chat', 'a2ui'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['chat', 'a2ui'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    // Non-null assertions are acceptable in test code: the test author
    // controls the fixtures, so a wrong assumption surfaces as a test
    // failure rather than a production bug. The rule stays strict for
    // library source (the `**/*.ts` block above).
    files: ['**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
