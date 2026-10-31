import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';

const SLUG = 'agui-pipeline';

/**
 * Vertical pipeline from an Angular component down to the AG-UI backend:
 * the runtime-neutral Agent contract, the `toAgent()` adapter, the AG-UI
 * `AbstractAgent` protocol client, then the backend (or a fake agent).
 */
export function AgUiArchitecturePipeline() {
  return (
    <DiagramFrame
      slug={SLUG}
      viewWidth={640}
      viewHeight={408}
      label="AG-UI adapter pipeline: an Angular component reads the Agent contract, toAgent reduces AG-UI events into signals via the AbstractAgent protocol client, which talks to the backend."
      description="Read from top to bottom. Your Angular component reads messages, status, isLoading, error, toolCalls, state and events$ from the @threadplane/chat Agent contract. The @threadplane/ag-ui adapter uses toAgent() to reduce protocol events into those signals. Its AbstractAgent client, supplied by @ag-ui/client, connects to an AG-UI backend. Tests can substitute an in-process fake agent at that boundary."
    >
      <DiagramNode x={130} y={16} w={380} h={44} title="Your Angular component" align="middle" titleStyle="sans" />
      <DiagramEdge d="M320 60 V80" slug={SLUG} arrow />
      <DiagramNode
        x={130} y={84} w={380} h={64}
        eyebrow="Agent contract" title="@threadplane/chat"
        meta="messages, status, isLoading, error, toolCalls, state, events$"
      />
      <DiagramEdge d="M320 148 V168" slug={SLUG} arrow />
      <DiagramNode
        x={130} y={172} w={380} h={64}
        eyebrow="Adapter" title="@threadplane/ag-ui"
        meta="toAgent() reduces AG-UI events into Angular signals"
        tone="accent"
      />
      <DiagramEdge d="M320 236 V256" slug={SLUG} arrow />
      <DiagramNode
        x={130} y={260} w={380} h={64}
        eyebrow="Protocol client" title="AbstractAgent" meta="@ag-ui/client"
      />
      <DiagramEdge d="M320 324 V344" slug={SLUG} arrow />
      <DiagramNode
        x={130} y={348} w={380} h={44}
        title="AG-UI backend or in-process fake agent"
        align="middle" titleStyle="sans" tone="dim"
      />
    </DiagramFrame>
  );
}
