import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Component Registry preview

Decide which component names a generated layout may use. A registry maps a plain name such as Badge to an authored React view, giving your application control of behavior and presentation.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Register the view contract

Each registry component receives \`RenderViewProps\`: resolved values in \`props\`, optional bindings, an element key, loading state, and children. A container must render its children exactly where they should appear. Keep the registry stable and define an intentional fallback for types your application does not provide.

~~~tsx
import type { ReactRenderRegistry } from '@threadplane/react/render';

export const tripViews: ReactRenderRegistry = {
  Heading: ({ props }) => <h2>{String(props['text'] ?? '')}</h2>,
  Card: ({ children }) => <section className="trip-card">{children}</section>,
};
~~~

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Try each registry mode

Choose **Run**, select **Basic Types**, **Card Layout** or **Mixed Components**, and press **Finish**. **Badge display** selects **Registered**, **Omitted** or **Fallback**. Registered maps Badge to its view. Omitted leaves Badge out of the registry, so the native renderer leaves it out of the view. Fallback uses the same reduced registry and supplies an authored component to display its label.

Changing registry mode does not rewrite the JSON or move playback. Your choice survives **Play**, **Pause**, **Playback position**, **Finish**, **Reset** and sample changes. Reloading restores Registered. No agent requests or saved browser state are used.

<ExampleCode file="cockpit/render/registry/react/src/specs.ts" />

## Supply components and native children

The host owns two stable frozen maps: the complete Heading, Text, Card and Badge registry, and a map with Badge omitted. RenderSpec receives the selected registry and the optional fallback. React uses a plain map of view components; this preview does not require Angular registry helpers.

A registered view receives read-only resolved props, elementKey, loading and children. Heading and Card display the children supplied by RenderSpec exactly once. Text and Badge are leaves. The authored fallback displays a literal label and uses the same loading flag. It is intentionally demonstrated only for the known Badge type omitted from the selected map.

<ExampleCode file="cockpit/render/registry/react/src/views.tsx" />

<ExampleCode file="cockpit/render/registry/react/src/app.tsx" />

## Admit the authored source before playback

Registry selection and source admission have separate jobs. This example admits the four authored types and literal display props before playing a sample. It rejects unknown types, expressions and executable fields. Then it copies bounded partial data without freezing the parser's mutable tree.

<ExampleCode file="cockpit/render/registry/react/src/projection.ts" />

The private playback owner rebuilds its parser on seek and revokes obsolete callbacks on Pause, Reset, selection changes and page exit. Complete requires the finished parser output to match the admitted source. Playback never changes registry choice.

<ExampleCode file="cockpit/render/registry/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-registry-react
npx nx e2e cockpit-render-registry-react
~~~

The isolated build installs local React, core and content artifacts with root-locked presentation dependencies. Browser coverage exercises all three registry modes, native fallback props and loading, playback retention, cleanup and narrow screens. Select **Angular** to read and run its existing registry implementation.
`;

export function ReactRegistryPreview({
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
