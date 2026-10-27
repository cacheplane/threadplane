import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Element Rendering preview

The native **@threadplane/react/render** component renders an authored tree and supplies its rendered children to readonly React views. This experimental local example covers ordered siblings, nested cards and visibility from caller-owned state.

## Try children, nesting and visibility

Choose **Run**, select **Parent + Children**, **Deep Nesting** or **Visibility**, then press **Finish**. Parent + Children displays two ordered Text children beneath a Heading. Deep Nesting displays one Text leaf inside two Card wrappers. Visibility includes one always-visible Text and a conditional detail.

**Show detail** updates explicit host state. Uncheck it to hide the conditional element, then check it to show the element. Changing the checkbox does not rewrite JSON or move playback. Your choice survives **Play**, **Pause**, **Playback position**, **Finish**, **Reset** and sample changes. Reloading shows detail. No agent requests or saved browser state are used.

<ExampleCode file="cockpit/render/element-rendering/react/src/specs.ts" />

## Use native rendered children

A stable readonly registry maps Heading, Text and Card to ordinary React components. RenderSpec supplies resolved props, elementKey, loading and children. Heading and Card display the supplied children exactly once; they do not walk the source graph themselves. Text is a leaf. The native tree owns sibling ordering and nesting.

<ExampleCode file="cockpit/render/element-rendering/react/src/views.tsx" />

The host supplies an immutable state object with a boolean showDetail value. The conditional Text uses the authored visibility binding to /showDetail. Native RenderSpec evaluates the binding; the host does not remove or rewrite source elements.

<ExampleCode file="cockpit/render/element-rendering/react/src/app.tsx" />

## Keep partial visibility faithful

This bounded local projection admits only three literal display types and the one authored conditional visibility path. The conditional node is withheld until its exact visibility metadata is available, preventing hidden text from flashing while JSON streams. Complete samples are admitted before playback; owned frozen copies leave the parser's mutable tree intact.

<ExampleCode file="cockpit/render/element-rendering/react/src/projection.ts" />

The private playback owner rebuilds the parser on seek and revokes obsolete callbacks on Pause, Reset, sample changes and page exit. Complete requires finished parser output to match the admitted source. Host visibility state remains independent of this owner.

<ExampleCode file="cockpit/render/element-rendering/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-element-rendering-react
npx nx e2e cockpit-render-element-rendering-react
~~~

The isolated static build installs local React, core and content artifacts with root-locked presentation dependencies. Browser coverage exercises native children and visibility, partial playback, retained host state, cleanup and narrow screens. Select **Angular** to read and run the existing Angular API example.
`;

export function ReactElementRenderingPreview({
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
