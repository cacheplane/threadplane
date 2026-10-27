import assert from 'node:assert/strict';
import test from 'node:test';
import { createProjectGraphAsync } from '@nx/devkit';
import { ESLint } from 'eslint';

test('actual Nx rule admits content A2UI types and rejects unrelated layers and framework/backend imports', async () => {
  const graph = await createProjectGraphAsync();
  assert.ok(graph.nodes.content.data.tags.includes('layer:content'));
  assert.ok(graph.nodes.a2ui.data.tags.includes('layer:a2ui'));
  const eslint = new ESLint();
  async function violations(target) {
    const [result] = await eslint.lintText(`import type { A2uiMessage } from '${target}';\nexport type Probe = A2uiMessage;\n`, {
      filePath: 'libs/content/src/a2ui/nx-policy-probe.ts',
    });
    assert.equal(result.fatalErrorCount, 0);
    return result.messages.filter((message) => message.ruleId === '@nx/enforce-module-boundaries');
  }
  assert.deepEqual(await violations('@threadplane/a2ui'), []);
  for (const target of ['@threadplane/angular', '@threadplane/react', '@threadplane/render', '@threadplane/langgraph', '@threadplane/ag-ui', 'react', 'react-dom', 'rxjs', '@angular/core', '@langchain/langgraph-sdk', '@ag-ui/client']) {
    assert.ok((await violations(target)).length > 0, `${target} must remain rejected`);
  }
});
