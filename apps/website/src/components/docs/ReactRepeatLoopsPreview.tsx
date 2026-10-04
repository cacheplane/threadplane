import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Repeat Loops preview

Add, remove and reverse caller-owned items using native **RenderSpec**. This experimental local example uses the installed **@threadplane/react/render** component and three authored JSON samples.

## Change a keyed list

Choose **Run**, select **Simple List** and press **Finish**. **Add Item** creates a new identity, **Remove** deletes the chosen item, and **Reverse items** changes the order while the existing row elements keep their identities. The list holds at most 32 items. Reloading restores Alpha, Beta and Gamma.

**Play** streams JSON locally. **Pause** holds its position, **Playback position** seeks, **Finish** displays the full sample, and **Reset** clears playback. Your list edits survive these controls and switching to **Task List** or **Sections**. Those two samples display literal task layouts. No agent requests or saved browser state are used.

<ExampleCode file="cockpit/render/repeat-loops/react/src/specs.ts" />

## Repeat children under one container

The React host passes immutable items through RenderSpec's state prop. In Simple List, the Card has repeat metadata with statePath **/items** and key **id**. The Card renders once; its Text child renders for each item. Child props use the authored item label, item id and repeat index. React keys each child group by the item's id.

This React container shape differs from Angular's repeating-element shape. Put the row beneath the repeated Card when using this preview. Heading, Text and Card are read-only registered views; Heading and Card display children supplied by the native renderer.

<ExampleCode file="cockpit/render/repeat-loops/react/src/views.tsx" />

<ExampleCode file="cockpit/render/repeat-loops/react/src/items.ts" />

<ExampleCode file="cockpit/render/repeat-loops/react/src/app.tsx" />

## Keep streamed repeat metadata complete

The caller admits a complete authored sample before playback and copies a bounded display subset of partial data. A repeated Card waits until both its exact path and key are ready. Item expressions wait for their authored values. Unsupported paths, nested repeats and executable fields are rejected. Parser state stays private.

<ExampleCode file="cockpit/render/repeat-loops/react/src/projection.ts" />

The private playback owner rebuilds its parser on seek and revokes obsolete callbacks on Pause, Reset, selection changes and page exit. Complete requires the finished parser output to match the admitted source. Playback never changes the host's list.

<ExampleCode file="cockpit/render/repeat-loops/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-repeat-loops-react
npx nx e2e cockpit-render-repeat-loops-react
~~~

The isolated build installs local React, core and content artifacts with root-locked presentation dependencies. Browser coverage exercises actual row identity, capacity, empty recovery, playback, cleanup and narrow screens. Select **Angular** to read and run its existing repeat implementation.
`;

export function ReactRepeatLoopsPreview({
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
