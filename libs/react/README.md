# @threadplane/react

Private, unpublished foundation scaffolding for the React parity work. These empty
entry points reserve planned package boundaries; they provide no supported runtime
API. No React bindings, stores, renderers, or backend adapters are implemented.

Reserved exports: `@threadplane/react`, `@threadplane/react/chat`, `@threadplane/react/markdown`, `@threadplane/react/a2ui`, `@threadplane/react/debug`, `@threadplane/react/tools`, `@threadplane/react/testing`.

Build with `npx nx build react`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.

Client entry points retain `use client`.
