# @threadplane/ag-ui-core

Private, unpublished foundation scaffolding for the React parity work. These empty
entry points reserve planned package boundaries; they provide no supported runtime
API. No React bindings, stores, renderers, or backend adapters are implemented.

Reserved exports: `@threadplane/ag-ui-core`, `@threadplane/ag-ui-core/testing`.

Build with `npx nx build ag-ui-core`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
