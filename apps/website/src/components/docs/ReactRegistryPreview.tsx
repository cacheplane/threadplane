import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Component Registry preview

A React registry maps authored type names to read-only view components. This experimental local example uses the installed **@threadplane/react/render** component and three authored JSON samples to show native registered views, omitted views and an authored fallback.

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
