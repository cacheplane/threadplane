import { DiagramFrame } from './DiagramFrame';
import { DiagramNode } from './DiagramNode';
import { DiagramEdge } from './DiagramEdge';
import { DiagramPill } from './DiagramPill';

const SLUG = 'render-how-it-fits';

/**
 * The three-step pipeline from `@threadplane/render`'s intro: an agent (or
 * your own code) produces a JSON spec, `@threadplane/render` validates and
 * renders it against a registry/state/functions/handlers, and the result is
 * a live tree of your own Angular components.
 */
export function RenderHowItFits() {
  return (
    <DiagramFrame
      slug={SLUG}
      viewWidth={640}
      viewHeight={280}
      label="Pipeline: a JSON spec flows into @threadplane/render, which renders it into your Angular components."
      description="An agent or your application produces a JSON specification. @threadplane/render resolves it using your component registry, state store, functions and event handlers. Bindings pass values into trusted Angular components; component events call the handlers your application registered. The specification selects from that registry rather than executing arbitrary generated component code."
    >
      <DiagramNode
        x={170}
        y={16}
        w={300}
        h={44}
        title="Agent or app output — a JSON Spec"
        align="middle"
        titleStyle="sans"
        tone="dim"
      />
      <DiagramEdge d="M320 60 V70" slug={SLUG} />
      <DiagramPill cx={320} cy={82} w={90} label="JSON Spec" />
      <DiagramEdge d="M320 94 V104" slug={SLUG} arrow />
      <DiagramNode
        x={170}
        y={108}
        w={300}
        h={64}
        eyebrow="Renderer"
        title="@threadplane/render"
        meta="registry · state store · functions · handlers"
        tone="accent"
      />
      <DiagramEdge d="M320 172 V182" slug={SLUG} />
      <DiagramPill cx={320} cy={194} w={140} label="bindings + events" />
      <DiagramEdge d="M320 206 V216" slug={SLUG} arrow />
      <DiagramNode
        x={170}
        y={220}
        w={300}
        h={44}
        title="Your Angular components"
        align="middle"
        titleStyle="sans"
      />
    </DiagramFrame>
  );
}
