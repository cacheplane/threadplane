import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { minimatch } from 'minimatch';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { capabilities } from '@threadplane/cockpit-registry';

const root = resolve(__dirname, '..');
const sharedUrl =
  'https://cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f.us.langgraph.app';
const workflow = readFileSync(
  resolve(root, '.github/workflows/deploy-langgraph.yml'),
  'utf8'
);
// Read the push filter itself: paths mentioned in jobs or comments must not
// satisfy trigger coverage. These positive globs use GitHub's ** semantics.
const pushPaths = (parse(workflow) as { on: { push: { paths: string[] } } }).on
  .push.paths;
const triggersDeployment = (file: string): boolean =>
  pushPaths.some((pattern) => minimatch(file, pattern, { dot: true }));
// Keep this selection aligned with generate-shared-deployment-config.ts.
const sharedCapabilities = capabilities.filter(
  (capability) =>
    capability.pythonDir &&
    capability.product !== 'ag-ui' &&
    capability.product !== 'runtimes'
);

describe('shared free deployment routing', () => {
  it.each(sharedCapabilities)(
    'redeploys for staged Python inputs of $id ($product)',
    (capability) => {
      const manifestPath = `${capability.pythonDir}/langgraph.json`;
      const manifest = JSON.parse(
        readFileSync(resolve(root, manifestPath), 'utf8')
      ) as { graphs: Record<string, string> };
      const files = [
        manifestPath,
        ...Object.values(manifest.graphs).map(
          (entrypoint) =>
            `${capability.pythonDir}/${entrypoint.split(':')[0].replace(/^\.\//, '')}`
        ),
      ];
      for (const file of files) {
        expect(existsSync(resolve(root, file)), file).toBe(true);
        expect(triggersDeployment(file), file).toBe(true);
      }
    }
  );

  it.each([
    'examples/chat/python/langgraph.json',
    'examples/chat/python/src/graph.py',
    '.github/workflows/deploy-langgraph.yml',
    'scripts/generate-shared-deployment-config.ts',
    'libs/cockpit-registry/src/lib/capability-registry.ts',
    'deployments/shared-dev/langgraph.json',
  ])('redeploys when shared deployment input %s changes', (file) => {
    expect(existsSync(resolve(root, file)), file).toBe(true);
    expect(triggersDeployment(file), file).toBe(true);
  });

  it.each(
    capabilities.filter(
      (capability) =>
        capability.pythonDir &&
        (capability.product === 'ag-ui' || capability.product === 'runtimes')
    )
  )('excludes separately deployed Python inputs of $id', (capability) => {
    const file = `${capability.pythonDir}/pyproject.toml`;
    expect(existsSync(resolve(root, file)), file).toBe(true);
    expect(triggersDeployment(file), file).toBe(false);
  });

  it('routes every active capability and both production proxy defaults to the free deployment', () => {
    const urls = JSON.parse(
      readFileSync(resolve(root, 'deployment-urls.json'), 'utf8')
    );
    expect(Object.keys(urls).length).toBeGreaterThan(0);
    expect([...new Set(Object.values(urls))]).toEqual([sharedUrl]);
    for (const file of [
      'scripts/examples-middleware.ts',
      'scripts/langgraph-proxy.ts',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).toContain(sharedUrl);
      expect(source).not.toContain(
        'cockpit-dev-219a15942c545a00a03a9a41905d7fc2'
      );
    }
  });

  it('updates only the pinned existing deployment and redeploys when its workflow changes', () => {
    const workflow = readFileSync(
      resolve(root, '.github/workflows/deploy-langgraph.yml'),
      'utf8'
    );
    const command = workflow
      .split('\n')
      .find((line) => line.includes('run: uv run'))!;
    expect(command).toContain('--with langgraph-cli==0.4.21');
    expect(command).toContain(
      '--deployment-id 6d350054-14ea-4031-8463-010ec27f9059'
    );
    expect(command).not.toMatch(/--name\b|--deployment-type\b/);
    expect(workflow).toContain("- '.github/workflows/deploy-langgraph.yml'");
  });
});
