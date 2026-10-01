import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';

const source = `# React streaming preview

This experimental example uses React with the same Python LangGraph streaming graph as the Angular example. This preview covers streaming; interrupts and thread-scoped memory also have authored React previews. The React, core, content, and framework-neutral LangGraph packages are private source-build packages; they are not published npm packages.

## Try the example

Choose **Run**, send a message, and watch the response arrive incrementally. Later messages reuse the confirmed conversation. **Stop** cancels active work. After cancellation or a request failure, choose **New conversation** before sending again; the example never silently retries an uncertain conversation creation.

The shared runtime uses the existing Threadplane example backend. A developer LangGraph connection uses the runtime settings in the workspace. Keep credentials in those settings, rather than in messages or application code.

## Ownership and rendering

A stable application owner controls the session and message-content lifetime. The session is created only after conversation creation is confirmed. React observes the application's snapshots through useAgent; the application controls conversation creation, cancellation, replacement, and disposal. Leaving the example releases the session and prevents late results from updating its UI.

<ExampleCode file="cockpit/langgraph/streaming/react/src/app.tsx" />

The connection uses the framework-neutral LangGraph session and the installed SDK. It shares the Python graph with Angular, while its UI and runtime bundle are separate.

<ExampleCode file="cockpit/langgraph/streaming/react/src/connection.ts" />

## Build from source

From a Threadplane repository checkout with dependencies installed:

~~~sh
npx nx build cockpit-langgraph-streaming-react
npx nx e2e cockpit-langgraph-streaming-react
~~~

The build installs local candidate packages in an isolated consumer and checks that the browser bundle uses those packages. The browser tests exercise real SDK requests against a local fixture. Run and Code on this page show the same React implementation. Streaming, interrupts, and memory have public React previews; other topics remain pending.
`;

export function ReactStreamingPreview({
  exampleCode,
}: {
  exampleCode: ExampleCodeContext | null;
}) {
  return (
    <div className="docs-workspace-article">
      <article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl">
        <MdxRenderer source={source} exampleCode={exampleCode} />
      </article>
    </div>
  );
}
