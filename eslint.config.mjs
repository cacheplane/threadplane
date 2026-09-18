import nx from '@nx/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  {
    ignores: [
      '**/dist',
      '**/out-tsc',
      '**/.next',
      '**/.next/**',
      '**/.vercel',
      '**/.vercel/**',
      '**/next-env.d.ts',
      '**/.install-collector/**',
      // Vendored byte-identical from upstream; its hash is pinned by a spec.
      'apps/website/src/vendor/scrollcraft/scrollcraft.js',
      'apps/website/e2e/scroll-craft/shoot.mjs',
    ],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [
            '^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$',
            '^.*/libs/cockpit-(docs|registry|shell|testing|ui)/src/index$',
            // The repo-root pricing config is shared with the website and
            // lives outside any Nx project on purpose.
            '^.*/pricing/tiers\\.config$',
          ],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
    },
  },
  {
    files: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.cts',
      '**/*.mts',
      '**/*.js',
      '**/*.jsx',
      '**/*.cjs',
      '**/*.mjs',
    ],
    // Override or add rules here
    rules: {},
  },
  // Growth libraries own shared server behavior, not application or publishing
  // orchestration. Keep deployment-specific imports at the app boundary.
  {
    files: ['libs/growth/src/**/*.ts', 'libs/growth-capture/src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/apps/**', '**/marketing/**', '@threadplane-internal/marketing-*'],
          message: 'Shared Growth code must not depend on apps or publishing tools.',
        }],
      }],
    },
  },
  {
    files: ['apps/growth-research/src/**/*.ts', 'apps/growth-research/scripts/**/*.mts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/lifecycle/**', '**/website/**'],
          message: 'Research must consume shared libraries rather than another app implementation.',
        }],
      }],
    },
  },
  {
    files: ['marketing/**/*.ts', 'marketing/**/*.tsx'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/apps/**', '**/libs/growth/**', '@threadplane-internal/growth'],
          message: 'Publishing tools must not access contact or lifecycle internals.',
        }],
      }],
    },
  },
  // Inline-style guard — apps/website migrated off static inline styles
  // (docs/superpowers/specs/2026-08-29-inline-style-substrate-migration-design.md,
  // batches #848–#857). Flags identifier-keyed members of a style object
  // literal. The escape hatch for dynamic values — style={{ '--x': value }} —
  // uses string-literal keys and passes. Genuinely dynamic identifier-keyed
  // values (rare) get a targeted eslint-disable-next-line with a reason.
  // Escalated to 'error' after v0.0.61 per the plan's two-step; every former
  // warning site now uses the escape hatch or a data-* state, so the rule
  // guards at zero suppressions.
  {
    files: ['apps/website/src/**/*.tsx'],
    ignores: [
      // Satori-rendered OG images: inline styles are the only mechanism there.
      'apps/website/src/app/opengraph-image.tsx',
      // NOTE: [slug] would be a glob character class, so match by wildcard.
      'apps/website/src/app/blog/*/opengraph-image.tsx',
      // The shared card kit both routes render through. Same reason: Satori
      // has no stylesheet, so every value is an inline style.
      'apps/website/src/app/card/**/*.tsx',
      // The GitHub Social Preview card, rendered by Satori through that same
      // kit. A Route Handler rather than a file-convention image, so it does
      // not match either opengraph-image pattern above.
      'apps/website/src/app/github-card/route.tsx',
      'apps/website/src/**/*.spec.tsx',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'JSXAttribute[name.name="style"] > JSXExpressionContainer > ObjectExpression > Property[key.type="Identifier"]',
          message:
            "Static presentation belongs in src/styles/*.css (see the substrate-migration spec). For dynamic values, set a CSS custom property: style={{ '--x': value }}.",
        },
      ],
    },
  },
];
