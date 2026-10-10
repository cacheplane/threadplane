import { defineConfig, devices } from '@playwright/test';
import { resolve } from 'node:path';
import { RUNTIME_BYPASS_STORAGE_STATE } from './e2e/runtime-bypass-setup';

type WebsitePlaywrightEnvironment = Readonly<
  Record<string, string | undefined>
>;

export const createWebsitePlaywrightConfig = (
  environment: WebsitePlaywrightEnvironment = process.env
) => {
  const localHost = '127.0.0.1';
  const localPort = environment['WEBSITE_E2E_PORT'] ?? '4308';
  const localURL = `http://${localHost}:${localPort}`;
  const runtimeURL = 'http://localhost:4300';
  const productionSmoke = environment['PRODUCTION_SMOKE'] === 'true';
  const bfcacheRuntimeTest = environment['CUSTOM_RUNTIME_BFCACHE'] === 'true';
  // The public-copy gate must read what a visitor receives, and `next dev`
  // serves a different bundle than production. This mode serves the already
  // completed Nx production build instead.
  const productionMode = environment['WEBSITE_E2E_MODE'] === 'production';
  const baseURL = environment['BASE_URL'] ?? localURL;
  const shouldStartLocalServer = !productionSmoke && !environment['BASE_URL'];
  const reuseExistingServer =
    environment['PLAYWRIGHT_REUSE_EXISTING_SERVER'] === 'true';

  // A PR preview embeds its runtime from a second protected Vercel project.
  // extraHTTPHeaders is global, so that origin needs its own bypass, seeded
  // once as a cookie by e2e/runtime-bypass-setup.ts. Both variables must be
  // present; the deploy job and local runs set neither.
  const runtimeBypass = Boolean(
    environment['RUNTIME_BYPASS_ORIGIN'] &&
      environment['VERCEL_EXAMPLES_AUTOMATION_BYPASS_SECRET']
  );

  // The public-copy gate crawls every sitemap route. Against a prebuilt
  // production server that is seconds; against `next dev` each route compiles
  // on demand, which is far too slow to belong in the ordinary suite. It runs
  // in production mode only, where its answers are the ones that matter.
  const modeIgnores: readonly string[] = productionSmoke
    ? ['**/public-copy.spec.ts']
    : productionMode
    ? [
        '**/platform-production-smoke.spec.ts',
        '**/custom-runtime-bfcache.spec.ts',
      ]
    : bfcacheRuntimeTest
    ? ['**/platform-production-smoke.spec.ts', '**/public-copy.spec.ts']
    : [
        '**/platform-production-smoke.spec.ts',
        '**/custom-runtime-bfcache.spec.ts',
        '**/public-copy.spec.ts',
      ];
  // The custom-target specs drive the fixture runtime on 127.0.0.1:4399 and
  // the local example apps, which exist only because this config starts them.
  // A run against a deployed BASE_URL — the post-promotion verification, the
  // production smoke — starts nothing, so every case would dial a fixture that
  // is not there and fail with ECONNREFUSED after the site already promoted.
  const fixtureDrivenSpecs: readonly string[] = [
    '**/custom-runtime-targets.spec.ts',
    '**/custom-runtime-bfcache.spec.ts',
  ];
  const testIgnore = shouldStartLocalServer
    ? [...modeIgnores]
    : [...new Set([...modeIgnores, ...fixtureDrivenSpecs])];

  return defineConfig({
    testDir: './e2e',
    testMatch: bfcacheRuntimeTest
      ? '**/custom-runtime-bfcache.spec.ts'
      : undefined,
    testIgnore,
    globalSetup: runtimeBypass
      ? resolve(__dirname, 'e2e', 'runtime-bypass-setup.ts')
      : undefined,
    fullyParallel: true,
    // Match the cockpit configs: 2 retries on CI to absorb transient Next.js
    // dev-server startup flake; 0 locally for fast feedback.
    retries: environment['CI'] ? 2 : 0,
    use: {
      baseURL,
      // Vercel deployment protection answers 302 -> vercel.com/sso-api for every
      // path on a preview, so a browser-driven check lands on an SSO page and
      // times out. When CI supplies the project's automation bypass, send it so
      // the preview is reachable. Every URL this suite touches is a first-party
      // Threadplane origin. Unset locally and in production runs.
      ...(environment['VERCEL_AUTOMATION_BYPASS_SECRET']
        ? {
            extraHTTPHeaders: {
              'x-vercel-protection-bypass':
                environment['VERCEL_AUTOMATION_BYPASS_SECRET'],
              // extraHTTPHeaders is global, so with a runtime bypass in play
              // this header would also reach the examples origin, asking it
              // to set a cookie for a secret that belongs to the Website
              // project. The bypass header alone still authorizes every
              // Website request; only skip the cookie request when a
              // runtime bypass is active.
              ...(runtimeBypass
                ? {}
                : { 'x-vercel-set-bypass-cookie': 'true' }),
            },
          }
        : {}),
      // Custom-target coverage carries an obvious fixture key. Keep browser
      // artifacts disabled so request headers and page state are never retained.
      trace: 'off',
      video: 'off',
      ...(runtimeBypass ? { storageState: RUNTIME_BYPASS_STORAGE_STATE } : {}),
    },
    // Declare chromium as the only browser project. This suppresses the
    // misleading "missing system dependencies" warning for webkit/firefox.
    projects: [
      {
        name: 'chromium',
        use: {
          ...devices['Desktop Chrome'],
          ...(bfcacheRuntimeTest
            ? {
                launchOptions: {
                  channel: 'chromium',
                  ignoreDefaultArgs: ['--disable-back-forward-cache'],
                  args: ['--enable-features=BackForwardCache'],
                },
              }
            : {}),
        },
      },
    ],
    webServer: shouldStartLocalServer
      ? [
          {
            command: productionMode
              ? // `nx serve --configuration=production` runs with the dist
                // directory as its cwd, and dist carries no `content/`. Routes
                // that read MDX at request time — /blog among them — then serve
                // an empty list, so the gate would pass against a page no
                // visitor sees. Link the content in before serving.
                `NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL='' npx nx build website --configuration=production --skip-nx-cache && ln -sfn ../../../apps/website/content dist/apps/website/content && npx nx serve website --configuration=production --port=${localPort} --skip-nx-cache`
              : bfcacheRuntimeTest
              ? `NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL='' npx nx build website --configuration=production --skip-nx-cache && npx nx serve website --configuration=production --port=${localPort} --skip-nx-cache`
              : `NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL='' npx next dev apps/website --hostname ${localHost} --port ${localPort}`,
            cwd: '../..',
            url: localURL,
            reuseExistingServer,
            // Server pages read the growth form policy while rendering, so the
            // local server carries the switch the deployed environment sets.
            env: { GROWTH_FORM_POLICY: 'growth_v1' },
            // A production run builds before it serves, which outlasts the
            // BFCache budget; each mode gets the time it actually needs.
            timeout: productionMode
              ? 300_000
              : bfcacheRuntimeTest
              ? 180_000
              : 60_000,
          },
          {
            command: bfcacheRuntimeTest
              ? 'npx nx build cockpit-langgraph-streaming-angular --configuration=cockpit --skip-nx-cache && npx http-server dist/cockpit/langgraph/streaming/angular -p 4300 -c-1'
              : 'npx nx run cockpit-langgraph-streaming-angular:serve:cockpit --port 4300',
            cwd: '../..',
            url: runtimeURL,
            reuseExistingServer,
          },
          ...(!bfcacheRuntimeTest
            ? [
                {
                  command:
                    'npx nx run cockpit-ag-ui-streaming-angular:serve:cockpit --port 4321',
                  cwd: '../..',
                  url: 'http://localhost:4321',
                  reuseExistingServer,
                },
                {
                  command:
                    'npx nx run cockpit-ag-ui-interrupts-angular:serve:cockpit --port 4320',
                  cwd: '../..',
                  url: 'http://localhost:4320',
                  reuseExistingServer,
                },
                {
                  command: 'npx nx run cockpit-ag-ui-tool-views-angular:serve:cockpit --port 4322',
                  cwd: '../..',
                  url: 'http://localhost:4322',
                  reuseExistingServer,
                },
                {
                  command: 'npx nx run cockpit-ag-ui-json-render-angular:serve:cockpit --port 4323',
                  cwd: '../..',
                  url: 'http://localhost:4323',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-ag-ui-subagents-angular:serve:cockpit --port 4326',
                  cwd: '../..',
                  url: 'http://localhost:4326',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'npx nx run cockpit-chat-threads-angular:serve:cockpit --port 4506',
                  cwd: '../..',
                  url: 'http://localhost:4506',
                  reuseExistingServer,
                },
                {
                  command: 'npx nx run cockpit-render-computed-functions-angular:serve:cockpit --port 4406',
                  cwd: '../..',
                  url: 'http://localhost:4406',
                  reuseExistingServer,
                  timeout: 180_000,
                },
              ]
            : []),
          {
            command:
              'npx tsx apps/website/e2e/fixtures/custom-runtime-server.ts',
            cwd: '../..',
            url: 'http://127.0.0.1:4399/health',
            reuseExistingServer,
          },
          ...(!bfcacheRuntimeTest
            ? [
                {
                  command:
                    // website:e2e builds every installed React example first,
                    // outside the server-readiness budget. Direct local
                    // Playwright runs require those build outputs too.
                    'node scripts/react-cockpit/serve.mjs',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4600',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs interrupts --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4601',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs memory --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4602',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs client-tools --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4603',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs persistence --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4604',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs durable-execution --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4605',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs subgraphs --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4606',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs time-travel --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4607',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command:
                    'node scripts/react-cockpit/serve.mjs deployment-runtime --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4608',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs ag-ui-streaming --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4609',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs ag-ui-interrupts --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4610',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs ag-ui-tool-views --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4611',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-ag-ui-json-render-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-json-render --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4612',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-ag-ui-subagents-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-subagents --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4613',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-spec-rendering --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4614',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-state-management --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4615',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-repeat-loops --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4616',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-registry --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4617',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-element-rendering --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4618',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'node scripts/react-cockpit/serve.mjs render-computed-functions --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4619',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-messages-python:smoke && node scripts/react-cockpit/serve.mjs chat-messages --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4620',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-input-python:smoke && node scripts/react-cockpit/serve.mjs chat-input --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4621',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-interrupts-python:smoke && node scripts/react-cockpit/serve.mjs chat-interrupts --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4622',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-tool-calls-python:smoke && node scripts/react-cockpit/serve.mjs chat-tool-calls --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4623',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-deep-agents-planning-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-planning --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4628',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-deep-agents-filesystem-python:smoke && node scripts/react-cockpit/serve.mjs deep-agents-filesystem --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4629',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-generative-ui-python:smoke && node scripts/react-cockpit/serve.mjs chat-generative-ui --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4627',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-timeline-python:smoke && node scripts/react-cockpit/serve.mjs chat-timeline --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4626',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-threads-python:smoke && node scripts/react-cockpit/serve.mjs chat-threads --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4625',
                  reuseExistingServer,
                  timeout: 180_000,
                },
                {
                  command: 'npx nx run cockpit-chat-subagents-python:smoke && node scripts/react-cockpit/serve.mjs chat-subagents --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4624',
                  reuseExistingServer,
                  timeout: 180_000,
                },
              ]
            : []),
        ]
      : undefined,
  });
};

export default createWebsitePlaywrightConfig();
