import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Render Spec preview

<DocsDemoVideo demo="ui" frontend="react" />

Describe a small interface as JSON and render it with your own React components. The specification supplies names, props, and child relationships; the registry supplies executable code.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Keep the registry outside the specification

\`RenderSpec\` takes plain specification data and a stable component map. The view receives resolved \`props\` and \`children\`; a container renders those children where they belong. This complete local example needs no agent. In the trip planner, the same boundary lets a backend describe an itinerary without shipping JavaScript.

~~~tsx
import { RenderSpec, type ReactRenderRegistry, type RenderSpecData } from '@threadplane/react/render';

const registry: ReactRenderRegistry = {
  Text: ({ props }) => <p>{String(props['text'] ?? '')}</p>,
};
const spec: RenderSpecData = {
  root: 'summary',
  elements: { summary: { type: 'Text', props: { text: 'Weekend in Portland' } } },
};

export function TripSummary() {
  return <RenderSpec spec={spec} registry={registry} />;
}
~~~

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Play a local sample

Choose **Run**, pick **Heading + Text**, **Card + Badge** or **Nested Layout**, and press **Play**. **Pause** holds the current position. Move **Playback position** to rewind or advance, **Finish** displays the complete sample, and **Reset** clears the current selection. Playing a completed sample starts it again from zero.

The two panels show the rendered view and the literal JSON prefix. These samples run locally and make no agent requests.

<ExampleCode file="cockpit/render/spec-rendering/react/src/specs.ts" />

## Register four views

The spec names a root and an elements map. Each type selects Heading, Text, Card or Badge from the authored registry. Literal props supply the text. RenderSpec supplies children to each registered view; Heading and Card display those children in the authored order.

<ExampleCode file="cockpit/render/spec-rendering/react/src/views.tsx" />

<ExampleCode file="cockpit/render/spec-rendering/react/src/app.tsx" />

## Keep partial data owned

The caller validates each bounded complete sample before playback, then copies and freezes the known partial display tree. Incomplete view names and missing child references wait until they are ready. These authored samples permit four view types and literal string props; they do not use actions, expressions or state bindings.

<ExampleCode file="cockpit/render/spec-rendering/react/src/projection.ts" />

A private parser owns the stream. Seeking rebuilds it from the selected prefix. Pause, sample changes, Reset and page exit cancel the current animation generation, so an old callback cannot replace the current display. Complete means the parser finished and its copied output matches the validated source.

<ExampleCode file="cockpit/render/spec-rendering/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-spec-rendering-react
npx nx e2e cockpit-render-spec-rendering-react
~~~

The isolated build installs local React, core and content package artifacts plus root-locked presentation dependencies. It verifies native RenderSpec and parser modules without a backend runtime. Browser coverage exercises all samples, partial playback, rewind, cancellation and narrow screens. Select **Angular** to read and run the existing Angular implementation.
`;

export function ReactRenderSpecPreview({
  exampleCode,
}: {
  readonly exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
