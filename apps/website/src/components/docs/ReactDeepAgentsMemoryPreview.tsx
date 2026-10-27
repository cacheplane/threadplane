import { MdxRenderer } from './MdxRenderer';
import type { ExampleCodeContext } from '../../lib/example-code';
const source = `# React Deep Agents Memory preview

This experimental native React example shares the canonical Python Memory graph and prompt. Angular remains the default frontend on this guide.

## Teach, then recall

Choose **Run**, type a message and choose **Send** or press **Enter**. **Teach** and **Recall** fill the draft without sending. Opening the example, changing mode or frontend, navigating history, filling a draft and choosing **New conversation** do not create a thread or author a run. Mode and history navigation preserve the mounted unsent draft; reload and New clear it.

Only explicit Send lazily creates an owned thread with **ifExists: raise**, using **da-memory**, **maxRetries: 0** and no automatic Retry or Resume. Followups reuse that thread. New and reload use a fresh thread on the next Send while retaining the captured browser scope.

<ExampleCode file="cockpit/deep-agents/memory/react/src/app.tsx" />
<ExampleCode file="cockpit/deep-agents/memory/react/src/connection.ts" />
<ExampleCode file="cockpit/deep-agents/memory/react/src/application.ts" />

## Browser identity and read-time evidence

The storage key **threadplane.deep-agents-memory.scope.v1** holds a canonical UUIDv4. The app captures the persisted readback winner once and sends exactly **context: { memory_scope }**. Storage is partitioned by origin and browser storage partition. Angular and React hosted on the same origin share the key. Unavailable or corrupt storage blocks Send before thread creation. Later replacement or deletion blocks future turns; an active turn may settle under its captured scope with a warning.

This is a logical partition, not authentication. Public state APIs fall outside this guarantee. There is no migration, read or reset of the historical global namespace.

<ExampleCode file="cockpit/deep-agents/memory/react/src/browser-scope.ts" />

**Agent Memory** preserves literal blank lines, Unicode and whitespace. Missing **{}** and a present empty file **''** are distinct. Fresh reads occur initially, before every model call and at terminal completion. Strict UTF-8 validation accepts at most 65,536 bytes after download materialization; this does not bound store allocation. The pinned middleware strips HTML comments and trailing whitespace from the model prompt, so recalled prompt text differs from the literal observation.

**store observed during this run** is custom live evidence, not durability. **confirmed checkpoint at read time** and **Response saved.** require native success and equality between current root state, fresh newest history, exact checkpoint and actual native transcript/load. Only absent private Memory keys may be omitted from live values; ordinary values and the full tool transcript must match. Loaded values must match fully. API values filtered through the graph output channels omit private Memory keys, while checkpoint events, custom events and raw checkpoints retain them. This is not a secrecy guarantee.

<ExampleCode file="cockpit/deep-agents/memory/react/src/memory-projection.ts" />
<ExampleCode file="cockpit/deep-agents/memory/react/src/authority.ts" />

## Restore and stop

Saved conversations restore an exact retained historical checkpoint through reads only. They do not show the current store. Failed initial, model or terminal reads and oversized observations are unavailable and cannot confirm Saved. A terminal failure after a write may leave that write persisted; there is no rollback. Stop cancels local delivery while backend work may continue. New invalidates late results. Conversations can update the same file at the same time.

## Shared backend and build

The StoreBackend namespace is **cockpit / deep-agents-memory / browser-v1 / scope**. Both frontends use these complete sources:

<ExampleCode file="cockpit/deep-agents/memory/python/src/graph.py" />
<ExampleCode file="cockpit/deep-agents/memory/python/src/memory_observation.py" />

~~~sh
npx nx build cockpit-deep-agents-memory-react
npx nx e2e cockpit-deep-agents-memory-react
~~~

Browser verification uses the actual compiled graph, installed SDK and offline deterministic model. Verification controls and fixtures are excluded from public Code.
`;
export function ReactDeepAgentsMemoryPreview({ exampleCode }: { readonly exampleCode: ExampleCodeContext | null }) {
  return <div className="docs-workspace-article"><article className="docs-article-layout flex-1 py-8 px-4 sm:px-6 md:px-12 md:max-w-3xl"><MdxRenderer source={source} exampleCode={exampleCode} /></article></div>;
}
