import { describe, expect, it } from 'vitest';
import { getCockpitDocsPath } from '@threadplane/cockpit-registry';
import { renderSpecRenderingPythonModule } from './spec-rendering/python/src/index';
import { renderElementRenderingPythonModule } from './element-rendering/python/src/index';
import { renderStateManagementPythonModule } from './state-management/python/src/index';
import { renderRegistryPythonModule } from './registry/python/src/index';
import { renderRepeatLoopsPythonModule } from './repeat-loops/python/src/index';
import { renderComputedFunctionsPythonModule } from './computed-functions/python/src/index';

describe('Render matrix slice', () => {
  it('exposes canonical python modules for the approved core capability topics', () => {
    const modules = [
      renderSpecRenderingPythonModule,
      renderElementRenderingPythonModule,
      renderStateManagementPythonModule,
      renderRegistryPythonModule,
      renderRepeatLoopsPythonModule,
      renderComputedFunctionsPythonModule,
    ];

    expect(modules).toHaveLength(6);
    expect(modules.map((module) => module.manifestIdentity.topic)).toEqual([
      'spec-rendering',
      'element-rendering',
      'state-management',
      'registry',
      'repeat-loops',
      'computed-functions',
    ]);

    for (const module of modules) {
      expect(module.manifestIdentity).toMatchObject({
        product: 'render',
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
