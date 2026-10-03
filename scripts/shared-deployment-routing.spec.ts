import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

const root = resolve(__dirname, '..');
const sharedUrl =
  'https://cockpit-dev-free-6957db75280055dcbbf2a4916c04b66f.us.langgraph.app';

describe('shared free deployment routing', () => {
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
