import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const topicNames = [
  'messages',
  'input',
  'interrupts',
  'tool-calls',
  'subagents',
  'threads',
  'timeline',
  'generative-ui',
  'debug',
  'theming',
] as const;

// Resolve from this file, not process.cwd(). These specs run under
// `nx test cockpit-registry`, whose cwd is libs/cockpit-registry — a cwd-relative root silently
// points at libs/cockpit-registry/cockpit/... and turns every existence assertion into
// a vacuous pass (or an unrelated ENOENT).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const chatRoot = path.join(repoRoot, 'cockpit', 'chat');

// The per-topic website .mdx assertions this spec used to carry asserted the
// five-segment docs shape #918 removed (see
// libs/cockpit-registry/src/lib/docs-links.ts: it "produced a URL that 404s for
// every product"). The website tree is organised by guide, not by cockpit
// topic. That coupling is now a table checked against the website's real
// content tree by apps/cockpit/src/lib/docs-links.spec.ts.
describe('Chat footprint', () => {
  it('creates the approved topic modules', () => {
    for (const topic of topicNames) {
      const moduleRoot = path.join(chatRoot, topic, 'python');
      const projectJsonPath = path.join(chatRoot, topic, 'angular', 'project.json');

      expect(fs.existsSync(path.join(moduleRoot, 'src', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(moduleRoot, 'prompts', `${topic}.md`))).toBe(
        true
      );
      expect(fs.existsSync(projectJsonPath)).toBe(true);

      const projectJson = JSON.parse(fs.readFileSync(projectJsonPath, 'utf8'));
      expect(projectJson.targets?.smoke?.executor).toBe('nx:run-commands');
    }
  });

  it('wires inline thread-title generation into every python graph', () => {
    for (const topic of topicNames) {
      const graphPath = path.join(chatRoot, topic, 'python', 'src', 'graph.py');
      const graphSource = fs.readFileSync(graphPath, 'utf8');

      expect(graphSource).toContain('async def generate_title');
      expect(graphSource).toContain('metadata={"title": title}');
      const explicitRegistration = graphSource.includes('add_node("generate_title", generate_title)');
      const loopRegistration = /for name, node in \([^\n]*\("generate_title", generate_title\)[^\n]*\):\n    _builder\.add_node\(name, node\)/.test(graphSource);
      expect(explicitRegistration || loopRegistration).toBe(true);
      expect(graphSource).toContain('add_edge("generate_title", END)');
    }
  });
});
