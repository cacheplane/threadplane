import {
  createJson,
  type JsonNode,
  type JsonSnapshot,
} from '@threadplane/content/json';
import { useAgent } from '@threadplane/react';

const owner = createJson({
  generation: 'a',
  phase: 'streaming',
  content: '{}',
});
const snapshot: JsonSnapshot = useAgent(owner);
// @ts-expect-error No implicit source phase.
createJson({ generation: 'a', content: '{}' });
// @ts-expect-error Public options do not expose a parser factory.
createJson(snapshot.document, { create: () => null });
// @ts-expect-error No schema inference or automatic argument validation.
createJson(snapshot.document, { schema: {} });
// @ts-expect-error Published delivery is immutable.
snapshot.document.content = 'changed';
if (snapshot.error) {
  // @ts-expect-error Published diagnostics are immutable.
  snapshot.error.index = 0;
}
export function checkJsonNode(node: JsonNode): void {
  // @ts-expect-error Published nodes are immutable.
  node.status = 'complete';
  // @ts-expect-error No parser parent pointers.
  void node.parentId;
  if (node.kind === 'array') {
    // @ts-expect-error Node collections are immutable.
    node.children.push(node);
    // @ts-expect-error Value collections are immutable.
    node.value.push(null);
  }
  if (node.kind === 'object') {
    // @ts-expect-error Child properties are immutable.
    node.children['a'] = node;
    // @ts-expect-error Value properties are immutable.
    node.value['a'] = null;
    // @ts-expect-error Content syntax does not infer a validated render spec.
    const spec: { root: string } = node.value;
    void spec;
  }
}
