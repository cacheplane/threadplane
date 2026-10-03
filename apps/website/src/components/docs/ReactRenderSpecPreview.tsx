import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Render Spec preview

Watch three authored JSON samples become React views as their text arrives. This experimental source-build example uses the installed **@threadplane/react/render** RenderSpec component and a local partial JSON parser.

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
