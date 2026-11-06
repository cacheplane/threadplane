import { describe, expect, it } from 'vitest';
import { getCockpitDocsPath } from '@threadplane/cockpit-registry';
import { langgraphStreamingPythonModule } from './streaming/python/src/index';
import { langgraphPersistencePythonModule } from './persistence/python/src/index';
import { langgraphDurableExecutionPythonModule } from './durable-execution/python/src/index';
import { langgraphInterruptsPythonModule } from './interrupts/python/src/index';
import { langgraphMemoryPythonModule } from './memory/python/src/index';
import { langgraphSubgraphsPythonModule } from './subgraphs/python/src/index';
import { langgraphTimeTravelPythonModule } from './time-travel/python/src/index';
import { langgraphDeploymentRuntimePythonModule } from './deployment-runtime/python/src/index';

describe('LangGraph matrix slice', () => {
  it('exposes canonical python modules for the approved core capability topics', () => {
    const modules = [
      langgraphPersistencePythonModule,
      langgraphDurableExecutionPythonModule,
      langgraphStreamingPythonModule,
      langgraphInterruptsPythonModule,
      langgraphMemoryPythonModule,
      langgraphSubgraphsPythonModule,
      langgraphTimeTravelPythonModule,
      langgraphDeploymentRuntimePythonModule,
    ];

    expect(modules).toHaveLength(8);
    expect(modules.map((module) => module.manifestIdentity.topic)).toEqual([
      'persistence',
      'durable-execution',
      'streaming',
      'interrupts',
      'memory',
      'subgraphs',
      'time-travel',
      'deployment-runtime',
    ]);

    for (const module of modules) {
      expect(module.manifestIdentity).toMatchObject({
        product: 'langgraph',
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
      // Examples grew extra code assets after this spec stopped running; it
      // is a floor, matching the chat and render matrix slices.
      expect(module.codeAssetPaths.length).toBeGreaterThanOrEqual(1);
    }
  });
});
