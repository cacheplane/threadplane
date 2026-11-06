import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  capabilityModules,
  cockpitManifest,
  resolveDocsWorkspace,
  type CockpitManifestEntry,
} from '@threadplane/cockpit-registry';
import {
  findWorkspaceRoot,
  resolveWorkspaceAssetPath,
  resolveRuntimeUrl,
  getContentBundle,
} from './workspace-content';
import {
  getWorkspacePresentation,
  type CapabilityPresentation,
} from './workspace-presentation';

const testEntry = cockpitManifest[0] as CockpitManifestEntry;

// Stable mock function references, hoisted so vi.mock factories can access them
const { mockExistsSync, mockReadFileSync, mockCodeToHtml } = vi.hoisted(() => ({
  mockExistsSync: vi.fn(),
  mockReadFileSync: vi.fn(),
  mockCodeToHtml: vi.fn(),
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: (...args: Parameters<typeof actual.existsSync>) => {
      mockExistsSync(...args);
      return actual.existsSync(...args);
    },
    default: { ...actual, readFileSync: mockReadFileSync },
    readFileSync: mockReadFileSync,
  };
});

vi.mock('shiki', () => ({
  default: { codeToHtml: mockCodeToHtml },
  codeToHtml: mockCodeToHtml,
}));

describe('resolveRuntimeUrl', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL when set', () => {
    vi.stubEnv(
      'NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL',
      'https://examples.threadplane.ai'
    );
    expect(
      resolveRuntimeUrl({ runtimeUrl: 'langgraph/streaming', devPort: 4300 })
    ).toBe('https://examples.threadplane.ai/langgraph/streaming');
  });

  it('falls back to localhost with devPort when the env var is explicitly empty', () => {
    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', '');
    expect(
      resolveRuntimeUrl({ runtimeUrl: 'langgraph/streaming', devPort: 4300 })
    ).toBe('http://localhost:4300');
  });

  it('uses the production runtime base when the env var is undefined', () => {
    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', undefined);

    expect(
      resolveRuntimeUrl({ runtimeUrl: 'langgraph/streaming', devPort: 4300 })
    ).toBe('https://examples.threadplane.ai/langgraph/streaming');
  });

  it('returns null when neither env var nor devPort is available', () => {
    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', '');
    expect(
      resolveRuntimeUrl({ runtimeUrl: undefined, devPort: undefined })
    ).toBeNull();
  });

  it('returns null when runtimeUrl is undefined even with env var set', () => {
    vi.stubEnv(
      'NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL',
      'https://examples.threadplane.ai'
    );
    expect(
      resolveRuntimeUrl({ runtimeUrl: undefined, devPort: undefined })
    ).toBeNull();
  });
});

describe('findWorkspaceRoot', () => {
  it('finds the Nx root when starting at the repository root', () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../..'
    );
    expect(findWorkspaceRoot(root)).toBe(root);
  });

  it('finds the Nx root when starting inside apps/website', () => {
    const root = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../../..'
    );
    expect(findWorkspaceRoot(`${root}/apps/website`)).toBe(root);
  });
});

describe('resolveWorkspaceAssetPath', () => {
  const workspaceRoot = '/workspace/repo';

  it('resolves a normal registry asset inside the workspace', () => {
    expect(
      resolveWorkspaceAssetPath(
        workspaceRoot,
        'cockpit/langgraph/streaming/python/src/graph.py'
      )
    ).toBe('/workspace/repo/cockpit/langgraph/streaming/python/src/graph.py');
  });

  it.each(['/private/secret.txt', '../outside.txt'])(
    'rejects an asset path outside the workspace: %s',
    (assetPath) => {
      expect(resolveWorkspaceAssetPath(workspaceRoot, assetPath)).toBeNull();
    }
  );
});

describe('getContentBundle', () => {
  beforeEach(() => {
    mockExistsSync.mockClear();
  });

  afterEach(() => {
    mockReadFileSync.mockReset();
    mockCodeToHtml.mockReset();
    vi.unstubAllEnvs();
  });

  it('returns highlighted code and raw prompt content for a capability presentation', async () => {
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.includes('index.ts')) return 'const x = 1;';
      if (p.includes('streaming.md')) return '# Streaming prompt';
      throw new Error(`ENOENT: ${filePath}`);
    });
    mockCodeToHtml.mockResolvedValue(
      '<pre class="shiki"><code>highlighted</code></pre>'
    );

    const presentation: CapabilityPresentation = {
      kind: 'capability',
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: [
        'cockpit/langgraph/streaming/python/prompts/streaming.md',
      ],
      codeAssetPaths: ['cockpit/langgraph/streaming/python/src/index.ts'],
      backendAssetPaths: [],
      runtimeUrl: 'langgraph/streaming',
      devPort: 4300,
    };

    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', '');
    const bundle = await getContentBundle(presentation);

    expect(Object.keys(bundle.codeFiles)).toContain(
      'cockpit/langgraph/streaming/python/src/index.ts'
    );
    expect(
      bundle.codeFiles['cockpit/langgraph/streaming/python/src/index.ts']
    ).toBe('<pre class="shiki"><code>highlighted</code></pre>');
    expect(bundle.promptFiles).toEqual({
      'cockpit/langgraph/streaming/python/prompts/streaming.md':
        '# Streaming prompt',
    });
    expect(bundle.runtimeUrl).toBe('http://localhost:4300');
    expect(bundle.docSections).toEqual([]);
    expect(mockExistsSync).toHaveBeenCalledTimes(1);
    expect(bundle.codeSources).toEqual({
      'cockpit/langgraph/streaming/python/src/index.ts': 'const x = 1;',
    });
  });

  it('returns a placeholder string when a code file is missing', async () => {
    mockReadFileSync.mockImplementation(() => {
      const err = new Error('ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      throw err;
    });

    const presentation: CapabilityPresentation = {
      kind: 'capability',
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: [],
      codeAssetPaths: ['missing/file.ts'],
      backendAssetPaths: [],
      runtimeUrl: undefined,
      devPort: undefined,
    };

    const bundle = await getContentBundle(presentation);

    expect(bundle.codeFiles['missing/file.ts']).toBe(
      'File not found: missing/file.ts'
    );
    expect(bundle.runtimeUrl).toBeNull();
    expect(bundle.docSections).toEqual([]);
    expect(bundle.codeSources).toEqual({});
  });

  it('falls back to unhighlighted code when Shiki fails', async () => {
    mockReadFileSync.mockReturnValue('const y = 2;');
    mockCodeToHtml.mockRejectedValue(new Error('Shiki error'));

    const presentation: CapabilityPresentation = {
      kind: 'capability',
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: [],
      codeAssetPaths: ['some/file.ts'],
      backendAssetPaths: [],
      runtimeUrl: undefined,
      devPort: undefined,
    };

    const bundle = await getContentBundle(presentation);

    expect(bundle.codeFiles['some/file.ts']).toBe(
      '<pre><code>const y = 2;</code></pre>'
    );
    expect(bundle.docSections).toEqual([]);
  });

  it('returns empty maps for a docs-only presentation', async () => {
    const presentation: CapabilityPresentation = {
      kind: 'docs-only',
      entry: testEntry,
      docsPath: '/docs/test',
    };

    const bundle = await getContentBundle(presentation);

    expect(bundle.codeFiles).toEqual({});
    expect(bundle.promptFiles).toEqual({});
    expect(bundle.runtimeUrl).toBeNull();
    expect(bundle.docSections).toEqual([]);
    expect(mockReadFileSync).not.toHaveBeenCalled();
    expect(mockCodeToHtml).not.toHaveBeenCalled();
    expect(bundle.codeSources).toEqual({});
  });

  it('extracts docSections from code and backend files', async () => {
    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const p = String(filePath);
      if (p.includes('streaming.component.ts'))
        return '/**\n * StreamingComponent renders a chat UI.\n */\nexport class StreamingComponent {}';
      if (p.includes('graph.py'))
        return 'class StreamingGraph:\n    """Streams LLM responses."""\n    pass';
      if (p.includes('streaming.md')) return '# Prompt';
      throw new Error('ENOENT');
    });
    mockCodeToHtml.mockResolvedValue(
      '<pre class="shiki"><code>highlighted</code></pre>'
    );

    const presentation = {
      kind: 'capability' as const,
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: ['prompts/streaming.md'],
      codeAssetPaths: ['src/streaming.component.ts'],
      backendAssetPaths: ['src/graph.py'],
      runtimeUrl: undefined,
      devPort: undefined,
    };

    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', '');
    const bundle = await getContentBundle(presentation);

    expect(bundle.docSections).toHaveLength(2);
    expect(bundle.docSections[0].title).toBe('StreamingComponent');
    expect(bundle.docSections[0].language).toBe('typescript');
    expect(bundle.docSections[1].title).toBe('StreamingGraph');
    expect(bundle.docSections[1].language).toBe('python');
  });

  it('contains missing prompt assets', async () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const presentation: CapabilityPresentation = {
      kind: 'capability',
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: ['missing/prompt.md'],
      codeAssetPaths: [],
      backendAssetPaths: [],
    };

    const bundle = await getContentBundle(presentation);

    expect(bundle.promptFiles).toEqual({
      'missing/prompt.md': 'File not found: missing/prompt.md',
    });
  });

  it('contains absolute and traversal paths without reading outside the workspace', async () => {
    const presentation: CapabilityPresentation = {
      kind: 'capability',
      entry: testEntry,
      docsPath: '/docs/test',
      promptAssetPaths: ['../outside-prompt.md'],
      codeAssetPaths: ['/private/secret.ts', '../outside-code.ts'],
      backendAssetPaths: [],
    };

    const bundle = await getContentBundle(presentation);

    expect(bundle.codeFiles).toEqual({
      '/private/secret.ts': 'File not found: /private/secret.ts',
      '../outside-code.ts': 'File not found: ../outside-code.ts',
    });
    expect(bundle.promptFiles).toEqual({
      '../outside-prompt.md': 'File not found: ../outside-prompt.md',
    });
    expect(mockReadFileSync).not.toHaveBeenCalled();
  });

  it('loads workspace-only capabilities from the same registry assets', async () => {
    const resolution = resolveDocsWorkspace(
      '/docs/angular/deep-agents/capabilities/memory',
      'Deep Agents Memory'
    );
    expect(resolution).not.toBeNull();
    if (!resolution) return;
    const presentation = getWorkspacePresentation(resolution);
    const descriptor = capabilityModules.find(
      (candidate) => candidate.id === 'deep-agents-memory-python'
    );
    expect(descriptor).toBeDefined();

    mockReadFileSync.mockImplementation((filePath: unknown) => {
      const path = String(filePath);
      if (path.endsWith('.md')) return '# Deep Agents Memory\n\nNarrative.';
      if (path.endsWith('.py')) return 'def graph():\n    pass';
      return 'export const memory = true;';
    });
    mockCodeToHtml.mockResolvedValue('<pre class="shiki">code</pre>');
    vi.stubEnv('NEXT_PUBLIC_COCKPIT_RUNTIME_BASE_URL', '');

    const bundle = await getContentBundle(presentation);

    expect(Object.keys(bundle.codeFiles)).toEqual([
      ...(descriptor?.codeAssetPaths ?? []),
      ...(descriptor?.backendAssetPaths ?? []),
    ]);
    expect(Object.keys(bundle.promptFiles)).toEqual(
      descriptor?.promptAssetPaths ?? []
    );
    expect(bundle.runtimeUrl).toBe('http://localhost:4313');
  });
});
