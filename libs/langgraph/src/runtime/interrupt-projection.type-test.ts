import type { Interrupt } from '@langchain/langgraph-sdk';
import type { DeepReadonly, PlainValue } from '@threadplane/core';
import type { LangGraphInterrupt } from './langgraph-snapshot';
import { projectInterrupts } from './interrupt-projection';

const wire: Interrupt<PlainValue> = {
  id: 'approval',
  value: { requested: [{ name: 'action' }] },
  namespace: ['child'],
  ns: ['legacy'],
  when: 'during',
  resumable: false,
};
const batch = projectInterrupts([], { type: 'interrupt', interrupt: wire });
const interrupt: LangGraphInterrupt = batch[0];
const sdkShape: DeepReadonly<Interrupt> = interrupt;
const payload: PlainValue = interrupt.value;
const metadata: readonly string[] | undefined = interrupt.namespace;
// @ts-expect-error The projected batch is readonly.
batch.push(wire);
// @ts-expect-error SDK metadata is readonly.
interrupt.id = 'changed';
// @ts-expect-error Protocol namespace arrays are readonly.
interrupt.namespace?.push('changed');
// @ts-expect-error Legacy namespace arrays are readonly too.
interrupt.ns?.push('changed');
// @ts-expect-error Plain payloads do not infer an application schema.
const request: { approved: boolean } = interrupt.value;
if (
  interrupt.value &&
  typeof interrupt.value === 'object' &&
  !Array.isArray(interrupt.value)
) {
  // @ts-expect-error Nested payload fields remain readonly.
  interrupt.value['changed'] = true;
}
void [sdkShape, payload, metadata, request];
