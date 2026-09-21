# @threadplane/react-render

Private, unpublished foundation scaffolding for the React parity work. These empty
entry points reserve planned package boundaries; they provide no supported runtime
API. No React bindings, stores, renderers, or backend adapters are implemented.

Reserved exports: `@threadplane/react-render`, `@threadplane/react-render/types`.

Build with `npx nx build react-render`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.

Client entry points retain `use client`; `/types` is pure.
