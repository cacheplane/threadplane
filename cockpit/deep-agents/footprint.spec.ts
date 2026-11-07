import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const topicNames = [
  'planning',
  'filesystem',
  'subagents',
  'memory',
  'skills',
] as const;

// Resolve from this file, not process.cwd(). These specs run under
// `nx test cockpit-registry`, whose cwd is libs/cockpit-registry — a cwd-relative root silently
// points at libs/cockpit-registry/cockpit/... and turns every existence assertion into
// a vacuous pass (or an unrelated ENOENT).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const deepAgentsRoot = path.join(repoRoot, 'cockpit', 'deep-agents');

// This spec used to also assert a website docs page per topic at
// content/docs/angular/deep-agents/core-capabilities/<topic>/python/<page>.mdx. That
// five-segment shape is the formula #918 removed: as
// libs/cockpit-registry/src/lib/docs-links.ts records, it "produced a URL that
// 404s for every product", and no `deep-agents` docs library exists on the
// website at all. The real website coupling now lives in the docs-links table
// and is checked against the website's actual content tree and nav config by
// apps/cockpit/src/lib/docs-links.spec.ts. What is left here is what
// "footprint" actually means: the cockpit modules exist and are runnable.
describe('Deep Agents footprint', () => {
  it('creates the approved topic modules', () => {
    for (const topic of topicNames) {
      const moduleRoot = path.join(deepAgentsRoot, topic, 'python');
      const projectJson = JSON.parse(
        fs.readFileSync(path.join(moduleRoot, 'project.json'), 'utf8')
      );

      expect(fs.existsSync(path.join(moduleRoot, 'package.json'))).toBe(true);
      expect(fs.existsSync(path.join(moduleRoot, 'tsconfig.json'))).toBe(true);
      expect(fs.existsSync(path.join(moduleRoot, 'src', 'index.ts'))).toBe(true);
      expect(fs.existsSync(path.join(moduleRoot, 'prompts', `${topic}.md`))).toBe(
        true
      );
      expect(projectJson.targets?.smoke?.executor).toBe('nx:run-commands');
      expect(projectJson.targets?.smoke?.options?.command).toContain(
        'src/index.ts'
      );
    }
  });
});
