import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';

const SLUG = 'render-vs-a2ui';

/**
 * The layering from the json-render-vs-A2UI concept page: `@threadplane/render`
 * is usable directly from your own app (no chat required), while
 * `@threadplane/chat` also detects assistant content and streams it into
 * whichever surface applies — a json-render spec on one side, an A2UI
 * surface on the other.
 */
export function RenderVsA2ui() {
  return (
    <DiagramFrame
      title="Two paths to a rendered interface"
      slug={SLUG}
      viewWidth={640}
      viewHeight={204}
      label="json-render versus A2UI: your Angular app renders json-render specs directly through @threadplane/render; @threadplane/chat also detects assistant content and mounts either a json-render spec or an A2UI surface. @threadplane/a2ui defines the A2UI v0.9 message and component types."
    >
      <DiagramNode
        x={20}
        y={16}
        w={160}
        h={44}
        title="Your Angular app"
        align="middle"
        titleStyle="sans"
        tone="dim"
      />
      <DiagramEdge d="M100 60 V120" slug={SLUG} arrow />
      <DiagramNode
        x={217}
        y={16}
        w={260}
        h={64}
        eyebrow="Chat UI"
        title="@threadplane/chat"
        meta="detects content, streams, mounts surfaces"
        tone="neutral"
      />
      <DiagramEdge d="M347 80 V100" slug={SLUG} />
      <DiagramEdge d="M347 100 H200 V120" slug={SLUG} arrow />
      <DiagramEdge d="M347 100 H494 V120" slug={SLUG} arrow />
      <DiagramNode
        x={16}
        y={124}
        w={260}
        h={64}
        eyebrow="json-render"
        title="@threadplane/render"
        meta="registry · state · functions · handlers"
        tone="accent"
      />
      <DiagramNode
        x={364}
        y={124}
        w={260}
        h={64}
        eyebrow="A2UI"
        title="@threadplane/a2ui"
        meta="A2UI v0.9 messages + component types"
        tone="accent"
      />
    </DiagramFrame>
  );
}
