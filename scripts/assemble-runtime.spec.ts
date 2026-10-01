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
