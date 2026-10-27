import { beforeEach, describe, expect, it, vi } from 'vitest';

const { writes } = vi.hoisted(() => ({ writes: new Map<string, string>() }));

vi.mock('child_process', () => ({ execSync: vi.fn(() => 'test-sha\n') }));
vi.mock('fs', () => ({
  cpSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  existsSync: vi.fn(() => true),
  writeFileSync: vi.fn((path: string, data: string) => writes.set(path, data)),
  readFileSync: vi.fn(() => '<html><head></head><body></body></html>'),
}));
vi.mock('@threadplane/cockpit-registry', () => ({
  capabilities: [{ product: 'langgraph', topic: 'chat' }],
  getCockpitFrontends: () => [
    { frontend: 'angular', product: 'langgraph', topic: 'streaming', project: 'cockpit-langgraph-streaming-angular', runtimePath: 'langgraph/streaming', buildOutput: 'dist/cockpit/langgraph/streaming/angular' },
    { frontend: 'react', product: 'langgraph', topic: 'streaming', project: 'cockpit-langgraph-streaming-react', runtimePath: 'langgraph/streaming/react', buildOutput: 'dist/cockpit/langgraph/streaming/react' },
  ],
}));
vi.mock('./generate-runtime-parent-origins', () => ({
  GENERATED_RUNTIME_PARENT_ORIGINS_MODULE: 'generated-origins.ts',
  parseRuntimeParentPreviewOrigins: () => [],
  generateRuntimeParentOriginPolicy: () => ({
    compiledChildModule: '',
    childAllowedParentOrigins: [],
    cspFrameAncestors: [],
  }),
}));

describe('assembled Vercel function runtimes', () => {
  it('stages registered React assets separately and routes React before Angular', async () => {
    const fs = await import('fs');
    vi.mocked(fs.readFileSync).mockImplementation(path => String(path).endsWith('runtime-parent-origins.json') ? '{}' : '<html><head></head><body></body></html>');
    await import('./assemble-examples.ts');
    expect(vi.mocked(fs.cpSync).mock.calls.some(([src, dest]) => String(src).endsWith('/dist/cockpit/langgraph/streaming/react') && String(dest).endsWith('/deploy/examples/langgraph/streaming/react'))).toBe(true);
    const config = JSON.parse([...writes.entries()].find(([path]) => path.endsWith('/output/config.json'))?.[1] ?? '{}');
    const react = config.routes.findIndex((route: {dest?: string}) => route.dest === '/langgraph/streaming/react/index.html');
    const angular = config.routes.findIndex((route: {dest?: string}) => route.dest === '/$1/$2/index.html');
    expect(react).toBeGreaterThan(-1);
    expect(react).toBeLessThan(angular);
    expect(config.routes.some((route: {src?: string; status?: number}) => route.src?.includes('/react') && route.status === 404)).toBe(true);
    expect([...writes.keys()].some(path => path.endsWith('/deploy/examples/langgraph/streaming/react/index.html'))).toBe(false);
  });
  beforeEach(() => {
    vi.resetModules();
    writes.clear();
  });

  it.each([
    ['examples', 2],
    ['demo', 1],
    ['ag-ui-demo', 1],
  ] as const)(
    'emits supported Node 22 for every %s function',
    async (name, count) => {
      // Execute the actual assembler; only external build/filesystem effects are mocked.
      const fs = await import('fs');
      vi.mocked(fs.readFileSync).mockImplementation((path) =>
        String(path).endsWith('runtime-parent-origins.json')
          ? '{}'
          : '<html><head></head><body></body></html>'
      );
      await import(`./assemble-${name}.ts`);
      const configs = [...writes.entries()].filter(([path]) =>
        path.endsWith('/.vc-config.json')
      );
      expect(configs).toHaveLength(count);
      for (const [, config] of configs) {
        expect(JSON.parse(config)).toEqual({
          runtime: 'nodejs22.x',
          handler: 'index.js',
          launcherType: 'Nodejs',
          shouldAddHelpers: true,
        });
      }
    }
  );
});
