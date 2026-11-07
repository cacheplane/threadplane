import { describe, expect, it } from 'vitest';
import { getCockpitDocsPath } from '@threadplane/cockpit-registry';
import { chatMessagesPythonModule } from './messages/python/src/index';
import { chatInputPythonModule } from './input/python/src/index';
import { chatInterruptsPythonModule } from './interrupts/python/src/index';
import { chatToolCallsPythonModule } from './tool-calls/python/src/index';
import { chatSubagentsPythonModule } from './subagents/python/src/index';
import { chatThreadsPythonModule } from './threads/python/src/index';
import { chatTimelinePythonModule } from './timeline/python/src/index';
import { chatGenerativeUiPythonModule } from './generative-ui/python/src/index';
import { chatDebugPythonModule } from './debug/python/src/index';
import { chatThemingPythonModule } from './theming/python/src/index';

describe('Chat matrix slice', () => {
  it('exposes canonical python modules for the approved core capability topics', () => {
    const modules = [
      chatMessagesPythonModule,
      chatInputPythonModule,
      chatInterruptsPythonModule,
      chatToolCallsPythonModule,
      chatSubagentsPythonModule,
      chatThreadsPythonModule,
      chatTimelinePythonModule,
      chatGenerativeUiPythonModule,
      chatDebugPythonModule,
      chatThemingPythonModule,
    ];

    expect(modules).toHaveLength(10);
    expect(modules.map((module) => module.manifestIdentity.topic)).toEqual([
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
    ]);

    for (const module of modules) {
      expect(module.manifestIdentity).toMatchObject({
        product: 'chat',
        section: 'core-capabilities',
        page: 'overview',
        language: 'python',
      });
      // The docs link is a table lookup, not a formula derived from the
      // identity: the cockpit tree and the website's docs tree do not share a
      // naming scheme. The table's targets are checked against the website's
      // real content tree in apps/cockpit/src/lib/docs-links.spec.ts.
      expect(module.docsPath).toBe(
        getCockpitDocsPath(
          module.manifestIdentity.product,
          module.manifestIdentity.section,
          module.manifestIdentity.topic
        )
      );
      expect(module.docsPath).toMatch(/^\/docs\/angular\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/);
      expect(module.promptAssetPaths.length).toBe(1);
      expect(module.codeAssetPaths.length).toBeGreaterThanOrEqual(1);
    }
  });
});
