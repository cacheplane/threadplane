// scripts/generate-shared-deployment-config.spec.ts
import { execFileSync } from 'child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { basename, dirname, resolve } from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capabilities } from '@threadplane/cockpit-registry';

describe('generate-shared-deployment-config', () => {
  const repoRoot = resolve(__dirname, '..');
  let root = '';

  afterAll(() => {
    if (root) rmSync(root, { recursive: true, force: true });
  });

  beforeAll(() => {
    root = mkdtempSync(resolve(tmpdir(), 'shared-deployment-config-'));
    const pythonDirs = new Set([
      ...capabilities.flatMap((capability) =>
        capability.pythonDir ? [capability.pythonDir] : []
      ),
      'examples/chat/python',
    ]);
    for (const pythonDir of pythonDirs) {
      const destination = resolve(root, pythonDir);
      mkdirSync(dirname(destination), { recursive: true });
      cpSync(resolve(repoRoot, pythonDir), destination, {
        recursive: true,
        // Local environments and bytecode are not authored fixture inputs.
        filter: (source) => !['.venv', '__pycache__'].includes(basename(source)),
      });
    }
    // Exercise the real CLI once; all cases read its freshly staged output.
    execFileSync(process.execPath, [
      resolve(repoRoot, 'node_modules/tsx/dist/cli.mjs'),
      '--tsconfig',
      resolve(repoRoot, 'tsconfig.base.json'),
      resolve(repoRoot, 'scripts/generate-shared-deployment-config.ts'),
    ], {
      cwd: root,
      stdio: 'pipe',
    });
  });

  it('includes the canonical-demo chat graph in the aggregated manifest', () => {
    const manifestPath = resolve(root, 'deployments/shared-dev/langgraph.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      graphs: Record<string, string>;
      dependencies: string[];
    };
    expect(manifest.graphs).toHaveProperty('chat');
    expect(manifest.graphs.chat).toMatch(/examples-chat\/.+\.py:graph$/);
    expect(manifest.dependencies.some((d) => d.includes('examples-chat'))).toBe(true);
  });

  it('excludes AG-UI capabilities (Railway-deployed; no langgraph.json)', () => {
    // Regression: AG-UI capabilities gained a pythonDir when they got real
    // uvicorn backends, which made the generator try to read a langgraph.json
    // they don't have — crashing every LangGraph deploy. They must be skipped
    // (they deploy via scripts/generate-ag-ui-deployment-config.ts → Railway).
    const manifestPath = resolve(root, 'deployments/shared-dev/langgraph.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dependencies: string[];
    };
    expect(manifest.dependencies.some((d) => d.includes('ag-ui'))).toBe(false);
  });

  it('carries the deepagents dependency set into every deep-agents staged dep', () => {
    // The deep-agents topics run on the real `deepagents` package, and the
    // shared deployment installs each staged dep from its own pyproject. If a
    // topic's pyproject loses the pin, nothing here fails until the deploy
    // does — the graph imports `deepagents` at module scope, so the revision
    // dies at startup rather than at build.
    //
    // `langchain-anthropic` and `langchain-google-genai` are mandatory
    // transitive imports of `deepagents` even for an OpenAI-only graph. They
    // are hard dependencies of the package itself, so pinning `deepagents`
    // is what brings them; this asserts the lock agrees rather than trusting
    // that.
    const deepAgentAliases = ['da-planning', 'da-filesystem', 'da-subagents', 'da-memory', 'da-skills'];
    for (const alias of deepAgentAliases) {
      const depRoot = resolve(root, 'deployments/shared-dev/deps', alias);
      const pyproject = readFileSync(resolve(depRoot, 'pyproject.toml'), 'utf8');
      expect(pyproject).toContain('deepagents==0.7.11');

      const lock = readFileSync(resolve(depRoot, 'uv.lock'), 'utf8');
      for (const transitive of ['langchain-anthropic', 'langchain-google-genai']) {
        expect(lock).toContain(`name = "${transitive}"`);
      }
    }
  });

  it('keeps every deep-agents graph in the aggregated manifest', () => {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'deployments/shared-dev/langgraph.json'), 'utf8'),
    ) as { graphs: Record<string, string> };

    // `subagents` is the odd one out: its graph name predates the `da-` prefix
    // and the Angular environment's assistantId matches it, so renaming it
    // would silently break that demo in production.
    expect(Object.keys(manifest.graphs)).toEqual(
      expect.arrayContaining(['da-planning', 'da-filesystem', 'subagents', 'da-memory', 'da-skills']),
    );
    expect(manifest.graphs).not.toHaveProperty('da-sandboxes');
  });
});
