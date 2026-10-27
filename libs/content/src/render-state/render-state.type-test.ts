import { createRenderState } from './index.js';
import type { RenderState, RenderStateValue, RenderStateSnapshot, RenderStateChange } from './index.js';
import { isRecord } from './owned-value.js';

const owner: RenderState = createRenderState({ initial: 1 });
const snapshot: RenderStateSnapshot = owner.getSnapshot();
const value: RenderStateValue = owner.get('/initial');
const change: RenderStateChange | undefined = owner.lastChange();
void value;
// @ts-expect-error Snapshot fields are readonly.
snapshot.initial = 2;
// @ts-expect-error A field remains the recursive union rather than an inferred initial schema.
const inferredNumber: number = owner.getSnapshot().initial;
void inferredNumber;
// @ts-expect-error Owner commands cannot be replaced.
owner.set = () => undefined;
const array: RenderStateValue = [1] as const;
// @ts-expect-error Array output is readonly.
array.push(2);
if (change) {
  // @ts-expect-error Change metadata is readonly.
  change.path = '/other';
}
// @ts-expect-error Initial state must be a record.
createRenderState([]);
// @ts-expect-error Updates must be a record.
owner.update(1);
// @ts-expect-error No generic schema is inferred or supported.
createRenderState<{ count: number }>({ count: 1 });
declare const unknownInput: unknown;
if (isRecord(unknownInput)) {
  // @ts-expect-error A shape check cannot establish owned value types.
  const owned: RenderStateSnapshot = unknownInput;
  void owned;
}
