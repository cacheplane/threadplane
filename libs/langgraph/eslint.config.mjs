import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    files: ['**/*.json'],
    rules: {
      '@nx/dependency-checks': [
        'error',
        {
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.runtime.config.mts',
            // The live-backend suite is test tooling, never packaged.
            '{projectRoot}/vite.live.config.mts',
            '{projectRoot}/live/**',
            // Specs, type tests and their helpers are not packaged.
            '{projectRoot}/src/**/*.spec.ts',
            '{projectRoot}/src/**/*.type-test.ts',
            '{projectRoot}/src/runtime/testing/**',
          ],
          ignoredDependencies: ['vite', '@nx/vite', 'vitest', 'tslib', '@langchain/core'],
        },
      ],
    },
    languageOptions: {
      parser: await import('jsonc-eslint-parser'),
    },
  },
];
