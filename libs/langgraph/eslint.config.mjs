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
          ignoredFiles: [
            '{projectRoot}/eslint.config.{js,cjs,mjs,ts,cts,mts}',
            '{projectRoot}/vite.config.mts',
            '{projectRoot}/vite.runtime.config.mts',
            // The live-backend suite is test tooling, never packaged.
            '{projectRoot}/vite.live.config.mts',
            '{projectRoot}/live/**',
            // Private runtime staging is not exported by the legacy Angular APF
            // package. Its neutral source graph is checked separately; do not
            // add unpublished core peers to the legacy production manifest.
            '{projectRoot}/src/runtime/**',
            // Phase 1 contract pin: this type-only spec imports private
            // @threadplane/core types to check the Angular ThreadDirectory copy.
            '{projectRoot}/src/lib/threads/thread-directory-contract.type-spec.ts',
          ],
          ignoredDependencies: ['vite', '@nx/vite'],
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
          prefix: ['lib', 'chat', 'debug'],
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: ['lib', 'chat', 'debug'],
          style: 'kebab-case',
        },
      ],
    },
  },
  {
    files: ['**/*.html'],
    // Override or add rules here
    rules: {},
  },
];
