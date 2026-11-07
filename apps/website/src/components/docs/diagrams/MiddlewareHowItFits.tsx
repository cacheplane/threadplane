import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramPill } from './DiagramPill';

const SLUG = 'middleware-how-it-fits';

/**
 * The middleware intro's runtime flow, condensed to three stages: the
 * browser declares client tools through `@threadplane/chat`, the
 * `threadplane-middleware` package binds those tool stubs onto the model —
 * runtime-neutral, since it ships both a Python `bind_client_tools()`
 * (`packages/threadplane-middleware`) and a TypeScript `bindClientTools()`
 * (`libs/middleware/src/langgraph/middleware.ts`) — and the bound model runs
 * inside your own LangGraph graph. Stacked vertically (matching the kit's
 * other how-it-fits diagrams) so the `client_tools` pill has its own 48px
 * gap between nodes instead of overlapping either flanking node.
 */
export function MiddlewareHowItFits() {
  return (
    <DiagramFrame
      title="How client tools reach your graph"
      slug={SLUG}
      viewWidth={640}
      viewHeight={276}
      label="How threadplane-middleware fits: the browser declares client tools through @threadplane/chat, threadplane-middleware binds them onto the model with bind_client_tools(), and the bound model runs inside your LangGraph graph."
    >
      <DiagramNode
        x={170}
        y={16}
        w={300}
        h={64}
        eyebrow="Frontend"
        title="@threadplane/chat"
        meta="<chat [clientTools]>"
        tone="neutral"
      />
      <DiagramEdge d="M320 80 V92" slug={SLUG} />
      <DiagramPill cx={320} cy={104} w={90} label="client_tools" />
      <DiagramEdge d="M320 116 V124" slug={SLUG} arrow />
      <DiagramNode
        x={170}
        y={128}
        w={300}
        h={64}
        eyebrow="Middleware"
        title="threadplane-middleware"
        meta="bind_client_tools() · bindClientTools()"
        tone="accent"
      />
      <DiagramEdge d="M320 192 V212" slug={SLUG} arrow />
      <DiagramNode
        x={170}
        y={216}
        w={300}
        h={44}
        title="Your LangGraph graph"
        align="middle"
        titleStyle="sans"
        tone="dim"
      />
    </DiagramFrame>
  );
}
