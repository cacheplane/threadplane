import type { AgentSnapshot, PlainValue } from '@threadplane/core';
import type { LangGraphSnapshot } from './langgraph-snapshot';

export function checkHistory(snapshot: LangGraphSnapshot, core: AgentSnapshot) {
  const page = snapshot.history;
  // @ts-expect-error Checkpoint history is backend-specific.
  void core.history;
  // @ts-expect-error The aggregate remains readonly.
  snapshot.history = [];
  if (!page) return;
  // @ts-expect-error The page remains readonly.
  page.pop();
  const entry = page[0];
  const id: string | null | undefined = entry.checkpoint.checkpoint_id;
  const namespace: string = entry.checkpoint.checkpoint_ns;
  const parent: string | null | undefined =
    entry.parent_checkpoint?.checkpoint_id;
  const created: string | null | undefined = entry.created_at;
  const value: PlainValue = entry.checkpoint.checkpoint_map?.['child'];
  // @ts-expect-error References remain readonly.
  entry.checkpoint.checkpoint_id = 'changed';
  if (entry.checkpoint.checkpoint_map) {
    // @ts-expect-error Nested map values remain readonly.
    entry.checkpoint.checkpoint_map['child'] = null;
  }
  // @ts-expect-error Next nodes remain readonly.
  entry.next.push('changed');
  // @ts-expect-error The page does not retain values or repeated transcripts.
  void entry.values;
  // @ts-expect-error The page has no task execution authority.
  void entry.tasks;
  void [id, namespace, parent, created, value];
}
