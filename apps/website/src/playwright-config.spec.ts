import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { getCockpitFrontends } from '@threadplane/cockpit-registry';
import { createWebsitePlaywrightConfig } from '../playwright.config';

describe('Website Playwright configuration', () => {
  it('builds every native React example before starting server readiness clocks', () => {
    const project = JSON.parse(
      readFileSync(resolve(import.meta.dirname, '../project.json'), 'utf8')
    );
    const prerequisites = project.targets.e2e.dependsOn?.find(
      (dependency: { target?: string }) => dependency.target === 'build'
    )?.projects ?? [];
    expect(prerequisites).toHaveLength(21);
    expect(new Set(prerequisites).size).toBe(21);
    expect([...prerequisites].sort()).toEqual(
      getCockpitFrontends()
        .filter(frontend => frontend.frontend === 'react')
        .map(frontend => frontend.project)
        .sort()
    );
    const config = createWebsitePlaywrightConfig({ CI: 'true' });
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    const nativeServer = servers.find(
      server => server.url === 'http://127.0.0.1:4600'
    );
    expect(nativeServer?.command).toBe('node scripts/react-cockpit/serve.mjs');
    expect(nativeServer?.timeout).toBe(180_000);
    expect(nativeServer?.reuseExistingServer).toBe(false);
  });
  it('builds Element Rendering in fresh Nx prerequisites and uses its own static server', () => {
    const config = createWebsitePlaywrightConfig({ CI: 'true' });
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    const project = JSON.parse(readFileSync(resolve(import.meta.dirname, '../project.json'), 'utf8'));
    expect(project.targets.e2e.dependsOn.find((dependency: { target?: string }) => dependency.target === 'build').projects).toContain('cockpit-render-element-rendering-react');
    expect(servers.find(server => server.url === 'http://127.0.0.1:4618')?.command).toBe('node scripts/react-cockpit/serve.mjs render-element-rendering --no-parent');
  });
  it('builds Computed Functions in fresh Nx prerequisites and uses its own static server', () => {
    const config = createWebsitePlaywrightConfig({ CI: 'true' });
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    const project = JSON.parse(readFileSync(resolve(import.meta.dirname, '../project.json'), 'utf8'));
    expect(project.targets.e2e.dependsOn.find((dependency: { target?: string }) => dependency.target === 'build').projects).toContain('cockpit-render-computed-functions-react');
    expect(servers.find(server => server.url === 'http://127.0.0.1:4619')?.command).toBe('node scripts/react-cockpit/serve.mjs render-computed-functions --no-parent');
  });
  it('owns the static Computed Functions Angular counterpart', () => {
    const config = createWebsitePlaywrightConfig({CI:'true'});
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    expect(servers.find(server => server.url === 'http://localhost:4406')?.command).toBe('npx nx run cockpit-render-computed-functions-angular:serve:cockpit --port 4406');
    const project = JSON.parse(readFileSync(resolve(import.meta.dirname,'../project.json'),'utf8'));
    expect(project.implicitDependencies).toContain('cockpit-render-computed-functions-angular');
  });

  it('owns the Tool Views Angular counterpart and twelfth installed React server', () => {
    const config = createWebsitePlaywrightConfig({CI:'true'});
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    expect(servers.find(server => server.url === 'http://localhost:4322')?.command).toBe('npx nx run cockpit-ag-ui-tool-views-angular:serve:cockpit --port 4322');
    expect(servers.find(server => server.url === 'http://127.0.0.1:4611')?.command).toBe('node scripts/react-cockpit/serve.mjs ag-ui-tool-views --no-parent');
    const project = JSON.parse(readFileSync(resolve(import.meta.dirname,'../project.json'),'utf8'));
    expect(project.implicitDependencies).toContain('cockpit-ag-ui-tool-views-angular');
  });
  it('starts twenty-one owned React servers after exact fresh Nx prerequisites', () => {
    const config = createWebsitePlaywrightConfig({ CI: 'true' });
    const servers = Array.isArray(config.webServer) ? config.webServer : [];
    const reactServers = servers.filter(server => /^http:\/\/127\.0\.0\.1:46(?:0\d|1[0123456789]|20)$/.test(server.url ?? ''));
    expect(reactServers).toHaveLength(21);
    expect(reactServers.every(server => server.reuseExistingServer === false)).toBe(true);
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4610')?.command).toBe('node scripts/react-cockpit/serve.mjs ag-ui-interrupts --no-parent');
    const project = JSON.parse(readFileSync(resolve(import.meta.dirname, '../project.json'), 'utf8'));
    const projects = project.targets.e2e.dependsOn.find(
      (dependency: { target?: string }) => dependency.target === 'build'
    ).projects;
    expect(projects).toHaveLength(21);
    expect(new Set(projects).size).toBe(21);
    expect(projects).toContain('cockpit-render-state-management-react');
    expect(projects).toContain('cockpit-render-repeat-loops-react');
    expect(projects).toContain('cockpit-render-registry-react');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4617')?.command).toBe('node scripts/react-cockpit/serve.mjs render-registry --no-parent');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4616')?.command).toBe('node scripts/react-cockpit/serve.mjs render-repeat-loops --no-parent');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4615')?.command).toBe('node scripts/react-cockpit/serve.mjs render-state-management --no-parent');
    expect(projects).toContain('cockpit-ag-ui-interrupts-react');
    expect(projects).toContain('cockpit-ag-ui-tool-views-react');
    expect(projects).toContain('cockpit-ag-ui-json-render-react');
    expect(projects).toContain('cockpit-ag-ui-subagents-react');
    expect(projects).toContain('cockpit-render-spec-rendering-react');
    expect(projects).toContain('cockpit-render-computed-functions-react');
    expect(projects).toContain('cockpit-chat-messages-react');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4620')?.command).toBe('npx nx run cockpit-chat-messages-python:smoke && node scripts/react-cockpit/serve.mjs chat-messages --no-parent');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4619')?.command).toBe('node scripts/react-cockpit/serve.mjs render-computed-functions --no-parent');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4614')?.command).toBe('node scripts/react-cockpit/serve.mjs render-spec-rendering --no-parent');
    expect(reactServers.find(server => server.url === 'http://127.0.0.1:4613')?.command).toBe('npx nx run cockpit-ag-ui-subagents-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-subagents --no-parent');
    expect(reactServers.find(server=>server.url==='http://127.0.0.1:4612')?.command).toBe('npx nx run cockpit-ag-ui-json-render-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-json-render --no-parent');
  });
  it('sends the Vercel automation bypass only when CI supplies it', () => {
    const withoutSecret = createWebsitePlaywrightConfig({});
    expect(withoutSecret.use?.extraHTTPHeaders).toBeUndefined();

    const withSecret = createWebsitePlaywrightConfig({
      VERCEL_AUTOMATION_BYPASS_SECRET: 'sentinel-value',
    });
    expect(withSecret.use?.extraHTTPHeaders).toEqual({
      'x-vercel-protection-bypass': 'sentinel-value',
      'x-vercel-set-bypass-cookie': 'true',
    });
  });

  it('keeps the production-smoke spec loadable under Playwright CJS transpilation', () => {
    const smoke = readFileSync(
      resolve(__dirname, '../e2e/platform-production-smoke.spec.ts'),
      'utf8'
    );

    // Playwright transpiles specs to CJS, so the ESM-only meta object compiles
    // to a `require` the loaded module cannot resolve and the file silently
    // fails to collect — the job then reports "No tests found" rather than
    // failing. Strip comments first: the spec names the trap in prose so it is
    // not reintroduced, and that mention must not trip this guard.
    const code = smoke
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toContain('import.meta');
  });

  it('derives the production embedding assertion from the authoritative origin source', () => {
    const smoke = readFileSync(
      resolve(__dirname, '../e2e/platform-production-smoke.spec.ts'),
      'utf8'
    );

    expect(smoke).toContain('runtime-parent-origins.json');
    expect(smoke).toContain('validateRuntimeParentOrigins');
    expect(smoke).toContain('RUNTIME_PARENT_PREVIEW_ORIGINS');
    expect(smoke).not.toContain(
      'frame-ancestors https://threadplane.ai http://localhost:3000'
    );
  });

  it('audits success-path Activity, diagnostics, analytics payloads, and browser logs without printing sensitive values', () => {
    const coverage = readFileSync(
      resolve(__dirname, '../e2e/custom-runtime-targets.spec.ts'),
      'utf8'
    );

    expect(coverage).toContain("page.on('console'");
    expect(coverage).toContain("page.on('pageerror'");
    expect(coverage).toContain("page.on('request'");
    expect(coverage).toContain('request.postData()');
    expect(coverage).toContain('navigator.clipboard.readText()');
    expect(coverage).toContain("name: 'Activity'");
    expect(coverage).toContain("name: 'Copy diagnostics'");
    expect(coverage).toContain('assertSensitiveValuesAbsent');
    expect(coverage).not.toContain('expect(activityText).not.toContain');
    expect(coverage).not.toContain('expect(diagnosticsText).not.toContain');
  });

  it('never starts local servers for production platform smoke', () => {
    const config = createWebsitePlaywrightConfig({
      PRODUCTION_SMOKE: 'true',
    });

    expect(config.webServer).toBeUndefined();
    // The smoke job hits the deployed site, so it runs every spec except the
    // public-copy gate, which exists to check a locally built production
    // server before the code is deployed at all, and the custom-target specs,
    // which drive a fixture runtime this config did not start.
    expect(config.testIgnore).toEqual([
      '**/public-copy.spec.ts',
      '**/custom-runtime-targets.spec.ts',
      '**/custom-runtime-bfcache.spec.ts',
    ]);
  });

  it('skips the fixture-driven specs when BASE_URL points at a deployed site', () => {
    // The deploy job re-runs the ordinary suite against production with only
    // BASE_URL set. No local server starts in that mode, so the custom-target
    // specs would dial a fixture on 127.0.0.1:4399 that does not exist and fail
    // every case with ECONNREFUSED — after the site was already promoted.
    const config = createWebsitePlaywrightConfig({
      BASE_URL: 'https://threadplane.ai',
    });

    expect(config.webServer).toBeUndefined();
    expect(config.use).toEqual(
      expect.objectContaining({ baseURL: 'https://threadplane.ai' })
    );
    expect(config.testIgnore).toEqual([
      '**/platform-production-smoke.spec.ts',
      '**/custom-runtime-bfcache.spec.ts',
      '**/public-copy.spec.ts',
      '**/custom-runtime-targets.spec.ts',
    ]);
  });

  it('holds the runtime frame by its session params rather than the local host', () => {
    // The reduced-motion check needs the runtime to stay in its connecting
    // state so the loader is on screen. Refusing `http://localhost:4300` only
    // does that against the local example app; against the deployed site the
    // frame loads from the production runtime origin, the handshake completes,
    // and the loader is gone before the assertion runs.
    const shell = readFileSync(
      resolve(__dirname, '../e2e/workspace-shell.spec.ts'),
      'utf8'
    );

    expect(shell).not.toContain("page.route('http://localhost:4300/**'");
    expect(shell).toContain("url.searchParams.has('cockpit_cap')");
  });

  it('seeds the runtime origin bypass only when both the origin and the examples secret are set', () => {
    const base = createWebsitePlaywrightConfig({
      BASE_URL: 'https://threadplane-pr-7-cacheplane.vercel.app',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'website-secret',
    });
    expect(base.globalSetup).toBeUndefined();
    expect(base.use?.storageState).toBeUndefined();

    const originOnly = createWebsitePlaywrightConfig({
      BASE_URL: 'https://threadplane-pr-7-cacheplane.vercel.app',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'website-secret',
      RUNTIME_BYPASS_ORIGIN:
        'https://threadplane-examples-pr-7-cacheplane.vercel.app',
    });
    expect(originOnly.globalSetup).toBeUndefined();

    const both = createWebsitePlaywrightConfig({
      BASE_URL: 'https://threadplane-pr-7-cacheplane.vercel.app',
      VERCEL_AUTOMATION_BYPASS_SECRET: 'website-secret',
      VERCEL_EXAMPLES_AUTOMATION_BYPASS_SECRET: 'examples-secret',
      RUNTIME_BYPASS_ORIGIN:
        'https://threadplane-examples-pr-7-cacheplane.vercel.app',
    });
    expect(both.globalSetup).toMatch(/runtime-bypass-setup\.ts$/);
    expect(both.use?.storageState).toMatch(
      /dist\/apps\/website\/e2e-runtime-bypass\/storage-state\.json$/
    );
    // The examples secret must never ride the global header, which reaches
    // the Website origin on every request.
    expect(JSON.stringify(both.use?.extraHTTPHeaders)).not.toContain(
      'examples-secret'
    );
    // The set-cookie header is dropped so the runtime origin is never asked
    // to issue a cookie for a wrong-project secret.
    expect(both.use?.extraHTTPHeaders).toEqual({
      'x-vercel-protection-bypass': 'website-secret',
    });
  });

  it('starts Website, all migrated runtime apps under custom-runtime E2E, and the fixture', () => {
    const config = createWebsitePlaywrightConfig({});

    expect(config.webServer).toEqual([
      expect.objectContaining({
        command: expect.stringContaining('next dev apps/website'),
        url: 'http://127.0.0.1:4308',
      }),
      expect.objectContaining({
        command: expect.stringContaining(
          'cockpit-langgraph-streaming-angular:serve:cockpit'
        ),
        url: 'http://localhost:4300',
      }),
      expect.objectContaining({
        command: expect.stringContaining(
          'cockpit-ag-ui-streaming-angular:serve:cockpit'
        ),
        url: 'http://localhost:4321',
      }),
      expect.objectContaining({
        command: expect.stringContaining(
          'cockpit-ag-ui-interrupts-angular:serve:cockpit'
        ),
        url: 'http://localhost:4320',
      }),
      expect.objectContaining({
        command: 'npx nx run cockpit-ag-ui-tool-views-angular:serve:cockpit --port 4322',
        url: 'http://localhost:4322',
      }),
      expect.objectContaining({
        command:'npx nx run cockpit-ag-ui-json-render-angular:serve:cockpit --port 4323',
        url:'http://localhost:4323',
      }),
      expect.objectContaining({
        command: 'npx nx run cockpit-ag-ui-subagents-angular:serve:cockpit --port 4326',
        url: 'http://localhost:4326',
      }),
      expect.objectContaining({
        command: expect.stringContaining(
          'cockpit-chat-threads-angular:serve:cockpit'
        ),
        url: 'http://localhost:4506',
      }),
      expect.objectContaining({command:'npx nx run cockpit-render-computed-functions-angular:serve:cockpit --port 4406',url:'http://localhost:4406'}),
      expect.objectContaining({
        command: expect.stringContaining('custom-runtime-server.ts'),
        url: 'http://127.0.0.1:4399/health',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs',
        url: 'http://127.0.0.1:4600',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs interrupts --no-parent',
        url: 'http://127.0.0.1:4601',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs memory --no-parent',
        url: 'http://127.0.0.1:4602',
      }),
      expect.objectContaining({
        command:
          'node scripts/react-cockpit/serve.mjs client-tools --no-parent',
        url: 'http://127.0.0.1:4603',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs persistence --no-parent',
        url: 'http://127.0.0.1:4604',
      }),
      expect.objectContaining({
        command:
          'node scripts/react-cockpit/serve.mjs durable-execution --no-parent',
        url: 'http://127.0.0.1:4605',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs subgraphs --no-parent',
        url: 'http://127.0.0.1:4606',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs time-travel --no-parent',
        url: 'http://127.0.0.1:4607',
      }),
      expect.objectContaining({
        command:
          'node scripts/react-cockpit/serve.mjs deployment-runtime --no-parent',
        url: 'http://127.0.0.1:4608',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs ag-ui-streaming --no-parent',
        url: 'http://127.0.0.1:4609',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs ag-ui-interrupts --no-parent',
        url: 'http://127.0.0.1:4610',
      }),
      expect.objectContaining({
        command: 'node scripts/react-cockpit/serve.mjs ag-ui-tool-views --no-parent',
        url: 'http://127.0.0.1:4611',
      }),
      expect.objectContaining({command:'npx nx run cockpit-ag-ui-json-render-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-json-render --no-parent',url:'http://127.0.0.1:4612'}),
      expect.objectContaining({command:'npx nx run cockpit-ag-ui-subagents-python:smoke && node scripts/react-cockpit/serve.mjs ag-ui-subagents --no-parent',url:'http://127.0.0.1:4613'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-spec-rendering --no-parent',url:'http://127.0.0.1:4614'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-state-management --no-parent',url:'http://127.0.0.1:4615'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-repeat-loops --no-parent',url:'http://127.0.0.1:4616'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-registry --no-parent',url:'http://127.0.0.1:4617'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-element-rendering --no-parent',url:'http://127.0.0.1:4618'}),
      expect.objectContaining({command:'node scripts/react-cockpit/serve.mjs render-computed-functions --no-parent',url:'http://127.0.0.1:4619'}),
      expect.objectContaining({command:'npx nx run cockpit-chat-messages-python:smoke && node scripts/react-cockpit/serve.mjs chat-messages --no-parent',url:'http://127.0.0.1:4620'}),
    ]);
    expect(config.testIgnore).toEqual([
      '**/platform-production-smoke.spec.ts',
      '**/custom-runtime-bfcache.spec.ts',
      // The public-copy gate crawls every sitemap route, which is seconds
      // against a prebuilt server and minutes against `next dev`. It belongs to
      // production mode, not the ordinary dev suite.
      '**/public-copy.spec.ts',
    ]);
    expect(config.use).toEqual(
      expect.objectContaining({ baseURL: 'http://127.0.0.1:4308' })
    );
    expect(config.use).toEqual(
      expect.objectContaining({ trace: 'off', video: 'off' })
    );
  });

  it('uses the production Website server and only the real BFCache test for lifecycle coverage', () => {
    const config = createWebsitePlaywrightConfig({
      CUSTOM_RUNTIME_BFCACHE: 'true',
    });
    const webServers = Array.isArray(config.webServer) ? config.webServer : [];

    expect(config.testMatch).toBe('**/custom-runtime-bfcache.spec.ts');
    expect(webServers[0]?.command).toContain(
      'nx build website --configuration=production --skip-nx-cache'
    );
    expect(webServers[0]?.command).toContain(
      'nx serve website --configuration=production'
    );
    expect(webServers[0]?.timeout).toBe(180_000);
    expect(webServers[1]?.command).toContain(
      'build cockpit-langgraph-streaming-angular --configuration=cockpit'
    );
    expect(webServers).toHaveLength(3);
    expect(config.projects?.[0]?.use?.launchOptions).toEqual({
      channel: 'chromium',
      ignoreDefaultArgs: ['--disable-back-forward-cache'],
      args: ['--enable-features=BackForwardCache'],
    });
  });
});
