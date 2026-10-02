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
                    'npx nx run cockpit-chat-threads-angular:serve:cockpit --port 4506',
                  cwd: '../..',
                  url: 'http://localhost:4506',
                  reuseExistingServer,
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
                    'npx nx run-many -t build --projects=cockpit-langgraph-streaming-react,cockpit-langgraph-interrupts-react,cockpit-langgraph-memory-react,cockpit-langgraph-client-tools-react,cockpit-langgraph-persistence-react,cockpit-langgraph-durable-execution-react --parallel=3 && node scripts/react-cockpit/serve.mjs',
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
                  command: 'node scripts/react-cockpit/serve.mjs durable-execution --no-parent',
                  cwd: '../..',
                  url: 'http://127.0.0.1:4605',
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
