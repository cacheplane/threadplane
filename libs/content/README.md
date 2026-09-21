# @threadplane/content

Private, unpublished foundation scaffolding for the React parity work. These empty
entry points reserve planned package boundaries; they provide no supported runtime
API. No React bindings, stores, renderers, or backend adapters are implemented.

Reserved exports: `@threadplane/content`, `@threadplane/content/render`, `@threadplane/content/markdown`, `@threadplane/content/json`, `@threadplane/content/a2ui`, `@threadplane/content/testing`.

Build with `npx nx build content`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
