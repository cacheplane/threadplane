import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React chat A2UI preview

This experimental native React example uses the existing shared Python Chat A2UI graph and c-a2ui assistant. Request a flight form, edit its fields, choose **Search**, **Select** a demonstration flight, then **Modify** to return to the search values supplied by the server, including the submitted route and party. It makes no real booking or payment. Angular remains the default on this canonical guide. The React, core, content, A2UI and neutral LangGraph candidates remain private, unpublished packages built from source.

## Start a conversation

Choose **Run**, type a request and choose **Send**. The suggestion only fills the composer. The first Send creates the conversation; **New conversation** clears the local view and waits for Send. Mounting, reading Docs or Code, and changing modes make no thread requests. Docs, Code and Run share the same native React implementation; mode navigation preserves the mounted frame and unsent draft, while reload clears local state.

<ExampleCode file="cockpit/chat/a2ui/react/src/app.tsx" />
<ExampleCode file="cockpit/chat/a2ui/react/src/main.tsx" />
<ExampleCode file="cockpit/chat/a2ui/react/src/connection.ts" />

## Edit the latest saved flight preview

Only the newest settled surface is interactive after a successful owned submission and confirmation against its exact saved root checkpoint and raw transcript. Older cards remain read-only and retain their last displayed edits. Streaming fragments, title metadata and completion flags do not enable controls. The application preserves immutable raw A2UI separately from editable form values. Invalid visible input stays invalid instead of falling back to an older valid value. Replaced cards cannot submit through stale callbacks.

<ExampleCode file="cockpit/chat/a2ui/react/src/application.ts" />
<ExampleCode file="cockpit/chat/a2ui/react/src/terminal.ts" />
<ExampleCode file="cockpit/chat/a2ui/react/src/data.ts" />

## A bounded booking profile

The ten supported views are **Column**, **Row**, **List**, **Card**, **Text**, **Divider**, **ChoicePicker**, **DateTimeInput**, **TextField** and **Button**. This closed flight example supports origin, destination, departure date, passenger count and fare class. Airports are LAX, JFK, SFO, ORD, BOS, ATL, DFW, SEA, MIA and DEN; fares are Economy, Premium, Business and First. Generic A2UI support for all 18 views remains pending; this preview does not claim full catalog parity or SSR support.

<ExampleCode file="cockpit/chat/a2ui/react/src/protocol.ts" />
<ExampleCode file="cockpit/chat/a2ui/react/src/form.ts" />
<ExampleCode file="cockpit/chat/a2ui/react/src/actions.ts" />
<ExampleCode file="cockpit/chat/a2ui/react/src/views.tsx" />

## Stop and recover

**Stop**, a run or connection error, or an unconfirmed outcome requires **New conversation** before continuing. Ordinary form-validation errors can be corrected in the current form. The app never automatically resubmits an action or resumes an uncertain turn. The shared graph may internally retry structured model output. **Modify** restores the search values supplied by the server, including the last submitted route and party, rather than recovering browser-local edits.

<ExampleCode file="cockpit/chat/a2ui/python/src/graph.py" />

## Build from source

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-chat-a2ui-react
npx nx e2e cockpit-chat-a2ui-react
~~~

Local verification uses the actual compiled Python graph, installed native packages and saved checkpoints with deterministic providers. It does not prove live-provider behavior. Fixtures and verification controls are excluded from public Code and output.
`;

export function ReactChatA2uiPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
