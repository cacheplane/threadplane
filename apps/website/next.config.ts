import { composePlugins, withNx } from '@nx/next';
import type { WithNxOptions } from '@nx/next/plugins/with-nx';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteAppDir = dirname(fileURLToPath(import.meta.url));

export const nextConfig: WithNxOptions = {
  // Use this to set Nx-specific options
  // See: https://nx.dev/recipes/next/next-config-setup
  nx: {},
  outputFileTracingRoot: join(websiteAppDir, '../..'),
  outputFileTracingIncludes: {
    '/*': [
      '../../cockpit/**/*.md',
      '../../cockpit/**/*.py',
      '../../cockpit/**/*.ts',
      '../../cockpit/**/*.tsx',
      '../../deployments/ag-ui-mastra/*.mjs',
      '../../nx.json',
      // The docs search route reads these at request time. Unlike
      // api/markdown it cannot be statically generated, so without this the
      // route deploys with no corpus and returns empty for every query —
      // silently, and only in production.
      'content/docs/**/*.mdx',
      // Growth validates blog observations against the catalog at request time.
      'content/blog/**/*.mdx',
      // The homepage stage proof lines are derived from the demo recording at
      // build time; traced as a safety net so a runtime read cannot 500.
      '../../examples/chat/angular/public/stage-replay.json',
    ],
  },
  skipTrailingSlashRedirect: true,
  // The dedicated telemetry docs library is retired in favour of the single
  // canonical policy. Delivered links and indexed search results outlive the
  // deletion, so every retired path lands on /privacy rather than a 404.
  redirects: async () => [
    { source: '/docs/telemetry', destination: '/privacy', permanent: true },
    {
      source: '/docs/telemetry/:path*',
      destination: '/privacy',
      permanent: true,
    },
    {
      source: '/api/markdown/telemetry',
      destination: '/privacy',
      permanent: true,
    },
    {
      source: '/api/markdown/telemetry/:path*',
      destination: '/privacy',
      permanent: true,
    },
    // `provideChat()`, `ChatConfig`, and `CHAT_CONFIG` were removed from
    // `@threadplane/chat`: no component ever read the token, so the API and its
    // configuration guide documented a no-op. The pages are gone; delivered
    // links land on installation, which is where the real providers are.
    {
      source: '/docs/chat/api/provide-chat',
      destination: '/docs/chat/getting-started/installation',
      permanent: true,
    },
    {
      source: '/docs/chat/api/chat-config',
      destination: '/docs/chat/getting-started/installation',
      permanent: true,
    },
    {
      source: '/docs/chat/guides/configuration',
      destination: '/docs/chat/getting-started/installation',
      permanent: true,
    },
    {
      source: '/api/markdown/chat/api/provide-chat',
      destination: '/api/markdown/chat/getting-started/installation',
      permanent: true,
    },
    {
      source: '/api/markdown/chat/api/chat-config',
      destination: '/api/markdown/chat/getting-started/installation',
      permanent: true,
    },
    {
      source: '/api/markdown/chat/guides/configuration',
      destination: '/api/markdown/chat/getting-started/installation',
      permanent: true,
    },
    // Founder booking link for lifecycle mail. Recipient copy carries this
    // first-party URL so every link matches the sending domain; the temporary
    // redirect lets the calendar page change without touching sent mail.
    {
      source: '/call',
      destination: 'https://calendar.app.google/nK961tWHZd21izKR6',
      permanent: false,
    },
  ],
  rewrites: async () => [
    {
      source: '/ingest/static/:path*',
      destination: 'https://us-assets.i.posthog.com/static/:path*',
    },
    {
      source: '/ingest/:path*',
      destination: 'https://us.i.posthog.com/:path*',
    },
  ],
  headers: async () => [
    {
      source: '/ingest/:path*',
      headers: [
        { key: 'Access-Control-Allow-Origin', value: '*' },
        { key: 'Access-Control-Allow-Methods', value: 'POST, OPTIONS' },
        {
          key: 'Access-Control-Allow-Headers',
          value: 'Content-Type, Authorization',
        },
        { key: 'Access-Control-Max-Age', value: '86400' },
      ],
    },
  ],
};

const plugins = [
  // Add more Next.js plugins to this list if needed.
  withNx,
];

export default composePlugins(...plugins)(nextConfig);
