import type { ExampleCodeContext } from '../../lib/example-code';
import { MdxRenderer } from './MdxRenderer';
const source = `# React AG-UI streaming preview

Watch an AG-UI backend turn a question into an answer one event at a time. The React UI observes normalized messages; the adapter handles the protocol events arriving from the server.

The native React APIs on this page are experimental, private source-build packages. Run the repository example to use them; they are not an npm installation recipe.

## Separate the protocol from the view

The application creates an AG-UI session for the configured endpoint. \`useAgent\` observes its snapshot, and the content projection supplies rows for \`MessageList\`. The stream can report progress before any assistant text appears, so use run status for the busy state and message delivery for text presentation. The walkthrough below follows this ordinary-text example through creation, submission, and completion.

The [conversation walkthrough](/docs/langgraph/concepts/conversation-turns) connects this capability to requests, tools, UI state, and saved history.

## Watch text arrive

Choose **Run** and send a fictional question. **Shared runtime** uses the existing examples site's agent route. Runtime settings can supply a **Developer runtime** AG-UI endpoint; its address is not displayed in the preview.

<ExampleCode file="cockpit/ag-ui/streaming/react/src/app.tsx" />

<ExampleCode file="cockpit/ag-ui/streaming/react/src/connection.ts" />

The native AG-UI session owns the request, transcript, state and run identity. React reads it through **useAgent** and displays its ordinary root text with **TextTranscript** and **ChatInput**. Markup stays literal text. See the [official AG-UI event documentation](https://docs.ag-ui.com/concepts/events) for text and run lifecycle events.

## Keep the current conversation

The first Send creates a local conversation UUID lazily. Later confirmed turns retain the native request history on that same UUID. A reply is complete only when the current run finishes successfully and its terminal thread/run IDs and full ordinary transcript agree with the submitted turn. Missing, stale or truncated results cannot authorize another Send.

<ExampleCode file="cockpit/ag-ui/streaming/react/src/canonical-transcript.ts" />

**New conversation** clears the transcript and draft immediately, creating another local UUID only on the next Send. **Stop** cancels active work. Tools, child agents, pauses, notices, errors and uncertain outcomes require New. Leaving the page revokes the old session; late content cannot restore it. The preview offers no replay, reconnect, resume or saved-history restoration control, and a local UUID does not claim server-side persistence.

<ExampleCode file="cockpit/ag-ui/streaming/react/src/application.ts" />

The React frontend and Python agent are separate artifacts. The frontend uses the existing shared AG-UI backend without changing its model, prompt or deployment.

<ExampleCode file="cockpit/ag-ui/streaming/python/src/server.py" />

## Source build and verification

From a Threadplane checkout with dependencies installed:

~~~sh
npx nx build cockpit-ag-ui-streaming-react
npx nx e2e cockpit-ag-ui-streaming-react
~~~

The isolated build installs the local candidate packages and checks strict types, the complete locked dependency graph and browser modules. Tests exercise the actual installed AG-UI client against local HTTP/SSE responses, including partial text, retained history, protected outcomes, developer endpoints and stream cancellation. Docs, Code and Run select this same React implementation. AG-UI Interrupts, Tool Views, JSON Render and Subagents and nine LangGraph topics also have public React previews; other topics remain pending.
`;
export function ReactAgUiStreamingPreview({
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
