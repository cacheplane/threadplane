import { createJson, type JsonNode, type JsonPartialValue } from './index.js';

const owner = createJson({
  generation: 'a',
  phase: 'streaming',
  content: '{}',
});
const snapshot = owner.getSnapshot();
// @ts-expect-error Delivery phase is explicit.
createJson({ generation: 'a', content: '{}' });
// @ts-expect-error No parser injection in the public API.
createJson(snapshot.document, { create: () => null });
// @ts-expect-error No inferred schemas or argument validation.
createJson(snapshot.document, { schema: {} });
// @ts-expect-error Content is primitive text.
owner.update({ generation: 'a', phase: 'complete', content: {} });
// @ts-expect-error Accepted input is immutable.
snapshot.document.content = 'other';
if (snapshot.error) {
  // @ts-expect-error Diagnostics are immutable.
  snapshot.error.code = 'TRAILING_CONTENT';
}
// @ts-expect-error Snapshot root is immutable.
snapshot.root = null;
export function checkNode(node: JsonNode): void {
  // @ts-expect-error Published nodes are immutable.
  node.status = 'complete';
  // @ts-expect-error No parser parent references.
  void node.parentId;
  if (node.kind === 'array') {
    // @ts-expect-error Child arrays are immutable.
    node.children.push(node);
    // @ts-expect-error Value arrays are immutable.
    node.value[0] = null;
  }
  if (node.kind === 'object') {
    // @ts-expect-error Child records are immutable.
    node.children['a'] = node;
    // @ts-expect-error Value records are immutable.
    node.value['a'] = null;
  }
  if (node.kind === 'number' || node.kind === 'string') {
    // @ts-expect-error Buffers are immutable.
    node.buffer = 'x';
  }
}
export function checkValue(value: JsonPartialValue): void {
  if (value !== null && typeof value === 'object') {
    // @ts-expect-error Partial values do not infer a validated render spec.
    const spec: { root: string } = value;
    void spec;
  }
}
