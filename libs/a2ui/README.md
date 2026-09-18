# @threadplane/a2ui

The A2UI (Agent-to-UI) protocol layer behind generative UI in [Threadplane](https://github.com/cacheplane/threadplane), the open-source thread-plane for agents, targeting the **A2UI v0.9.1 stable release**. It defines the wire format an agent uses to drive a UI surface, plus the parser and resolver that read it — framework-agnostic, pure TypeScript, no Angular dependency, usable in any TypeScript environment.

<p align="center">
  <a href="https://www.npmjs.com/package/@threadplane/a2ui">
    <img alt="npm version" src="https://img.shields.io/npm/v/@threadplane%2Fa2ui?color=15253E&labelColor=0A0A0A&style=flat-square" />
  </a>
  <a href="https://opensource.org/licenses/MIT">
    <img alt="MIT" src="https://img.shields.io/badge/License-MIT-15253E?labelColor=0A0A0A&style=flat-square" />
  </a>
</p>

## What it does

- **Protocol type system** — full TypeScript type vocabulary for every A2UI v0.9 message, component, dynamic value, action, and client→agent message.
- **Streaming message parser** — `createA2uiMessageParser()` returns a stateful parser that accepts JSONL chunks from a streaming agent response and emits typed `A2uiMessage` values as lines complete.
- **Dynamic value resolution** — `resolveDynamic()` resolves a dynamic value (bare literal or `{ path }` binding) against a client data model; `isPathRef` / `isFunctionCall` guards narrow dynamic values before use.
- **JSON-pointer utilities** — `getByPointer`, `setByPointer`, and `deleteByPointer` navigate and mutate the A2UI client data model using JSON-pointer paths, including the v0.9 array-delete rule (index set to `undefined`, length preserved).
- **Runtime-neutral** — pure TypeScript, no runtime dependencies, works in browsers and Node.js alike. Consumed by `@threadplane/chat` to render agent-emitted generative UI.

## Install

```bash
npm install @threadplane/a2ui
```

No peer dependencies required.

## Quick start

### Parse a streaming A2UI response

```typescript
import { createA2uiMessageParser } from '@threadplane/a2ui';
import type { A2uiMessage } from '@threadplane/a2ui';

const parser = createA2uiMessageParser();

// Feed chunks as they arrive from your agent's streaming response:
function onChunk(chunk: string): void {
  const messages: A2uiMessage[] = parser.push(chunk);
  for (const msg of messages) {
    if ('createSurface' in msg) {
      console.log('New surface:', msg.createSurface.surfaceId);
    } else if ('updateComponents' in msg) {
      console.log('Components for:', msg.updateComponents.surfaceId);
    } else if ('updateDataModel' in msg) {
      console.log('Data model update at:', msg.updateDataModel.path ?? '/');
    } else if ('deleteSurface' in msg) {
      console.log('Delete surface:', msg.deleteSurface.surfaceId);
    }
  }
}
```

Every envelope carries `"version": "v0.9"`. The component whose `id` is `"root"` is the tree root — rendering can begin as soon as it arrives, and the tree fills in progressively.

### Resolve dynamic values against a data model

```typescript
import { resolveDynamic } from '@threadplane/a2ui';

const model = { user: { name: 'Alice' } };

// Bare literal — passes through unchanged
const label = resolveDynamic('Submit', model);
// => 'Submit'

// Path binding — resolves against the model via JSON pointer
const name = resolveDynamic({ path: '/user/name' }, model);
// => 'Alice'
```

### JSON-pointer utilities

```typescript
import { getByPointer, setByPointer, deleteByPointer } from '@threadplane/a2ui';

const model = { items: [{ id: 1 }, { id: 2 }] };

getByPointer(model, '/items/0/id');       // => 1
const updated = setByPointer(model, '/items/0/id', 99);
const removed = deleteByPointer(updated, '/items/0/id');
```

## Capabilities

### Protocol message parsing

`createA2uiMessageParser()` returns an `A2uiMessageParser` with a single `push(chunk: string): A2uiMessage[]` method. The parser is stateful — it buffers partial lines between calls and emits complete messages as JSONL lines arrive. Malformed lines are silently skipped (safe for mid-stream partial JSON), and unknown envelope keys — such as future v1.0 messages — are skipped rather than treated as errors.

```typescript
const parser = createA2uiMessageParser();
const messages = parser.push(chunk); // A2uiMessage[]
```

### Dynamic value resolution

`resolveDynamic(value, model, scope?)` resolves A2UI v0.9 dynamic values:

- Bare literals (string, number, boolean, string arrays, plain objects) — pass through unchanged.
- `{ path: string }` — looked up in `model` via JSON pointer. If an `A2uiScope` is provided, relative paths resolve against `scope.basePath` (used inside `children` templates).
- `{ call: string, args? }` — client-side function calls, executed through the registry passed as the fourth argument (`createA2uiFunctionRegistry()` provides the standard set: `formatString` with `${...}` interpolation, `formatNumber`, `formatCurrency`, `formatDate`, `pluralize`, `and`, `or`, `not`). Args resolve recursively. Without a registry, or for unknown names, calls resolve to `undefined`.

Type guards:

| Guard | Narrows to |
|---|---|
| `isPathRef(v)` | `{ path: string }` |
| `isFunctionCall(v)` | `{ call: string; args?: Record<string, unknown> }` |

### JSON-pointer utilities

Three immutable helpers operate on `Record<string, unknown>` data models:

| Function | Description |
|---|---|
| `getByPointer(model, pointer)` | Read the value at `pointer`. Returns `undefined` if the path does not exist. |
| `setByPointer(model, pointer, value)` | Return a new model with `value` written at `pointer`. |
| `deleteByPointer(model, pointer)` | Return a new model with the key at `pointer` removed. Array indices are set to `undefined`, preserving length (v0.9 rule). |

Pointers follow standard `/segment/segment` syntax. An empty pointer (`''` or `'/'`) targets the root.

### Type system

`@threadplane/a2ui` exports the complete A2UI v0.9 type vocabulary. Categories include:

- **Protocol constants** — `A2UI_WIRE_VERSION` (`'v0.9'`), `A2UI_MIME_TYPE` (`'application/a2ui+json'`), `A2UI_BASIC_CATALOG_ID`
- **Envelopes** — `A2uiMessage`, `A2uiCreateSurface`, `A2uiUpdateComponents`, `A2uiUpdateDataModel`, `A2uiDeleteSurface`
- **Components** — `A2uiComponent`, `A2uiComponentBase`, `A2uiCatalogComponent`, plus per-component shapes: `A2uiText`, `A2uiImage`, `A2uiIcon`, `A2uiVideo`, `A2uiAudioPlayer`, `A2uiRow`, `A2uiColumn`, `A2uiList`, `A2uiCard`, `A2uiTabs`, `A2uiModal`, `A2uiDivider`, `A2uiButton`, `A2uiCheckBox`, `A2uiTextField`, `A2uiDateTimeInput`, `A2uiChoicePicker`, `A2uiSlider`
- **Dynamic values** — `DynamicString`, `DynamicNumber`, `DynamicBoolean`, `DynamicStringList`, `DynamicValue`, `A2uiPathRef`, `A2uiFunctionCall`
- **Actions and checks** — `A2uiAction`, `A2uiEventAction`, `A2uiFunctionAction`, `A2uiCheck`, `A2uiCheckable`
- **Client → agent** — `A2uiActionMessage`, `A2uiErrorMessage`, `A2uiClientDataModel`, `A2uiClientCapabilities`
- **Theming** — `A2uiTheme`
- **Parser and scope** — `A2uiMessageParser`, `A2uiScope`, `A2uiChildren`

## Reliability

Pure TypeScript with no runtime dependencies. No `Buffer`, no `process`, no DOM — safe in any TypeScript environment. Follows the repo's patch-only `0.0.x` release policy. The "Library — lint / test / build" CI job runs on every pull request.

## License

MIT. See [LICENSE](../../LICENSE).
