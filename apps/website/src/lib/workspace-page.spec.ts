import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { compile } from '@tailwindcss/node';
import { Scanner } from '@tailwindcss/oxide';
import { describe, expect, it } from 'vitest';
import { nextConfig } from '../../next.config';
import {
  getExampleCodeContext,
  getWebsiteWorkspacePage,
} from './workspace-page';

const workspaceRoot = process.cwd().endsWith('/apps/website')
  ? resolve(process.cwd(), '../..')
  : process.cwd();

describe('getWebsiteWorkspacePage', () => {
  it('loads Deployment Runtime React from the canonical deployment slug without Angular source fallback', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/deployment',
      title: 'Deployment',
    });
    const react = page.frontendVariants?.react;
    expect(react?.presentation.runtimeUrl).toBe(
      'langgraph/deployment-runtime/react'
    );
    const files = Object.keys(react?.contentBundle.codeFiles ?? {});
    for (const file of [
      'app.tsx',
      'application.ts',
      'canonical-history.ts',
      'connection.ts',
      'main.tsx',
    ])
      expect(files).toContain(
        `cockpit/langgraph/deployment-runtime/react/src/${file}`
      );
    expect(files).toContain(
      'cockpit/langgraph/deployment-runtime/python/src/graph.py'
    );
    expect(files.some((path) => path.includes('/angular/'))).toBe(false);
    expect(page.presentation.runtimeUrl).toBe('langgraph/deployment-runtime');
  });
  it('loads a bounded React variant with matching source and runtime', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/streaming',
      title: 'Streaming',
    });
    const react = page.frontendVariants?.react;
    expect(react?.resolution).toMatchObject({
      kind: 'mapped',
      identity: { id: expect.stringMatching(/:react$/), language: 'python' },
    });
    expect(react?.presentation).toMatchObject({
      runtimeUrl: 'langgraph/streaming/react',
    });
    expect(Object.keys(react?.contentBundle.codeFiles ?? {})).toContain(
      'cockpit/langgraph/streaming/react/src/app.tsx'
    );
    expect(
      Object.keys(react?.contentBundle.codeFiles ?? {}).some((path) =>
        path.includes('/angular/')
      )
    ).toBe(false);
    const unsupported = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/testing',
      title: 'Testing',
    });
    expect(unsupported.frontendVariants?.react).toBeUndefined();
  });
  it('loads Time Travel canonical history and full checkpoint source helpers with the exact React runtime', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/time-travel',
      title: 'Time Travel',
    });
    const react = page.frontendVariants?.react;
    expect(react?.presentation.runtimeUrl).toBe('langgraph/time-travel/react');
    const files = Object.keys(react?.contentBundle.codeFiles ?? {});
    for (const file of [
      'application.ts',
      'checkpoint-history.ts',
      'canonical-history.ts',
    ])
      expect(files).toContain(
        `cockpit/langgraph/time-travel/react/src/${file}`
      );
    expect(files).toContain(
      'cockpit/langgraph/time-travel/python/src/graph.py'
    );
    expect(files.some((path) => path.includes('/angular/'))).toBe(false);
    expect(page.presentation.runtimeUrl).toBe('langgraph/time-travel');
  });
  it('loads the Subgraphs parent owner and exact frontend runtime together', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/subgraphs',
      title: 'Subgraphs',
    });
    const react = page.frontendVariants?.react;
    expect(react?.presentation.runtimeUrl).toBe('langgraph/subgraphs/react');
    const files = Object.keys(react?.contentBundle.codeFiles ?? {});
    expect(files).toContain(
      'cockpit/langgraph/subgraphs/react/src/application.ts'
    );
    expect(files).toContain('cockpit/langgraph/subgraphs/python/src/graph.py');
    expect(files.some((path) => path.includes('/angular/'))).toBe(false);
    expect(page.presentation.runtimeUrl).toBe('langgraph/subgraphs');
  });
  it('loads descriptor-backed content for a mapped LangGraph docs page', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/streaming',
      title: 'Streaming',
    });

    expect(page.resolution).toMatchObject({
      kind: 'mapped',
      identity: {
        id: 'langgraph:core-capabilities:streaming:overview:python',
        availableModes: ['Docs', 'Run', 'Code', 'API'],
      },
    });
    expect(page.presentation).toMatchObject({
      kind: 'capability',
      runtimeUrl: 'langgraph/streaming',
      codeAssetPaths: expect.arrayContaining([
        'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
      ]),
    });
    expect(page.contentBundle.runtimeUrl).toMatch(
      /(?:langgraph\/streaming|localhost:4300)$/
    );
    expect(Object.keys(page.contentBundle.codeFiles)).toEqual(
      expect.arrayContaining([
        'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
        'cockpit/langgraph/streaming/python/src/graph.py',
      ])
    );
  });

  it('uses the explicit primary capability for a duplicate docs path', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/persistence',
      title: 'Persistence',
    });

    expect(page.resolution).toMatchObject({
      kind: 'mapped',
      identity: {
        id: 'langgraph:core-capabilities:persistence:overview:python',
        topic: 'persistence',
      },
    });
  });

  it('keeps a mapped limited-mode entry truthful', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/getting-started/introduction',
      title: 'Introduction',
    });

    expect(page.resolution).toMatchObject({
      kind: 'mapped',
      identity: {
        id: 'langgraph:getting-started:overview:overview:python',
        availableModes: ['Docs'],
      },
    });
    expect(page.presentation).toMatchObject({
      kind: 'docs-only',
      runnable: false,
    });
    expect(page.contentBundle).toEqual({
      codeFiles: {},
      codeSources: {},
      promptFiles: {},
      runtimeUrl: null,
      docSections: [],
    });
  });

  it('returns a docs-only model for an unmapped valid docs page', async () => {
    const page = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/testing',
      title: 'Testing',
    });

    expect(page.resolution).toEqual({
      kind: 'docs-only',
      docsPath: '/docs/langgraph/guides/testing',
      title: 'Testing',
      unavailableReason: 'no-workspace-capability',
    });
    expect(page.presentation).toEqual({
      kind: 'docs-only',
      docsPath: '/docs/langgraph/guides/testing',
      title: 'Testing',
      runnable: false,
    });
    expect(page.contentBundle.runtimeUrl).toBeNull();
  });

  it('builds an example-code context for a page with code assets', async () => {
    const model = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/streaming',
      title: 'Streaming',
    });
    const context = getExampleCodeContext(model);

    expect(context?.docsPath).toBe('/docs/langgraph/guides/streaming');
    expect(context?.assetPaths).toEqual([
      'cockpit/langgraph/streaming/angular/src/app/streaming.component.ts',
      'cockpit/langgraph/streaming/angular/src/app/app.config.ts',
      'cockpit/langgraph/streaming/python/src/graph.py',
    ]);
    expect([...Object.keys(context?.sources ?? {})].sort()).toEqual(
      [...(context?.assetPaths ?? [])].sort()
    );
  });

  it('has no example-code context for a docs-only page', async () => {
    const model = await getWebsiteWorkspacePage({
      docsPath: '/docs/langgraph/guides/testing',
      title: 'Testing',
    });
    expect(getExampleCodeContext(model)).toBeNull();
  });

  it('traces registry-owned workspace assets in production bundles', () => {
    expect(nextConfig.outputFileTracingRoot).toBe(workspaceRoot);
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      '/*': expect.arrayContaining([
        '../../cockpit/**/*.md',
        '../../cockpit/**/*.py',
        '../../cockpit/**/*.ts',
        '../../deployments/ag-ui-mastra/*.mjs',
        '../../nx.json',
      ]),
    });
  });

  it('imports shared workspace CSS once and scopes Docs geometry to the article slot', () => {
    const layoutSource = readFileSync(
      resolve(workspaceRoot, 'apps/website/src/app/layout.tsx'),
      'utf8'
    );
    const globalCss = readFileSync(
      resolve(workspaceRoot, 'apps/website/src/app/global.css'),
      'utf8'
    );
    const docsCss = readFileSync(
      resolve(workspaceRoot, 'apps/website/src/styles/docs.css'),
      'utf8'
    );

    expect(
      globalCss.match(/workspace-react\/src\/styles\/workspace\.css/g)
    ).toHaveLength(1);
    expect(layoutSource).toMatch(
      /import\s+["']@threadplane\/design-tokens\/tokens\.css["'];[\s\S]*import\s+["']\.\/global\.css["'];/
    );
    expect(docsCss).toMatch(
      /\.docs-workspace-article\s*\{[\s\S]*height:\s*100%[\s\S]*overflow-y:\s*auto/
    );
    expect(docsCss).toMatch(/\.docs-workspace-article\s+\.docs-article-layout/);
  });

  it('scans shared workspace components for Tailwind v4 utilities', async () => {
    const globalCssPath = resolve(
      workspaceRoot,
      'apps/website/src/app/global.css'
    );
    const compiler = await compile(readFileSync(globalCssPath, 'utf8'), {
      base: dirname(globalCssPath),
      from: globalCssPath,
      onDependency() {
        return undefined;
      },
    });
    const candidates = new Scanner({ sources: compiler.sources }).scan();

    expect(candidates).toContain('text-[10px]');
    expect(compiler.build(candidates)).toMatch(/\.text-\\\[10px\\\]/);
  });
});
