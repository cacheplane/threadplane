import { Annotation } from '@langchain/langgraph';
import type { ClientToolSpec } from './types.js';

/**
 * State channels for the client-tools catalog. Spread into Annotation.Root so a graph
 * declares the `tools` (primary) and `client_tools` (fallback) slices in one line:
 *
 * ```ts
 * const State = Annotation.Root({ ...MessagesAnnotation.spec, ...clientToolsChannel() });
 * ```
 *
 * Both are last-value-wins channels (the catalog is replaced per run, not accumulated).
 */
export function clientToolsChannel() {
  return {
    tools: Annotation<ClientToolSpec[] | undefined>(),
    client_tools: Annotation<ClientToolSpec[] | undefined>(),
  };
}
