import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';

const source = `# React Computed Functions preview

Watch three authored JSON samples transform text, multiply numbers and format dates. The experimental native **@threadplane/react/render** RenderSpec resolves the samples’ computed expressions with four pure functions supplied by the React caller. Everything runs locally and makes no agent requests.

## Play a local sample

Choose **Run**, select **Text Transforms**, **Data Display** or **Mixed Functions**, then press **Play**. **Pause** holds the current position. Move **Playback position** to rewind or advance, **Finish** displays the complete sample, and **Reset** clears playback for the selected sample. Playing a completed sample starts it again from zero. Changing samples starts fresh and paused.

Text Transforms produces **HELLO WORLD** and **gnimaerts**. Data Display multiplies 7 by 6 to produce **42** and formats its date. Mixed Functions produces **60**, **COMPUTED FUNCTIONS** and a second date. Date formatting follows the viewer’s browser locale and time zone.

<ExampleCode file="cockpit/render/computed-functions/react/src/specs.ts" />

## Supply pure functions

The caller passes an owned function map through **RenderSpec.functions**. A JSON value names a function with **$computed** and supplies its **args**. The native resolver resolves those arguments, invokes the registered function and supplies its returned value to the registered view. These samples preserve those expressions as data throughout playback.

Functions must be pure and synchronous. The renderer may evaluate them repeatedly. It supplies recursively owned, frozen arguments and accepts plain render-data results; async work and side effects belong outside these callbacks.

<ExampleCode file="cockpit/render/computed-functions/react/src/functions.ts" />

<ExampleCode file="cockpit/render/computed-functions/react/src/app.tsx" />

Heading, Card and Value display the resolved props and authored child order.

<ExampleCode file="cockpit/render/computed-functions/react/src/views.tsx" />

## Stream complete calculations

This preview admits only its three authored samples, their four computation names and declared argument values. The controls select from three bounded authored samples. A calculation waits until its expression and all arguments are complete, so a numeric or date prefix cannot briefly display an incorrect result. The copied display tree is frozen independently of the private parser.

<ExampleCode file="cockpit/render/computed-functions/react/src/projection.ts" />

Seeking rebuilds the parser from the selected prefix. Pause, sample changes, Reset and page exit cancel the current playback generation. Completion requires the parser’s final copied output to match the validated authored source.

<ExampleCode file="cockpit/render/computed-functions/react/src/playback.ts" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-render-computed-functions-react
npx nx e2e cockpit-render-computed-functions-react
~~~

The isolated build installs local React, core and content package artifacts plus root-locked presentation dependencies. Browser coverage exercises all computed samples, partial playback, rewind, cancellation and narrow screens. Select **Angular** to read and run the existing Angular implementation.
`;

export function ReactComputedFunctionsPreview({
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
