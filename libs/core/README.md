# @threadplane/core

Private, unpublished foundation scaffolding for the React parity work. These empty
entry points reserve planned package boundaries; they provide no supported runtime
API. No React bindings, stores, renderers, or backend adapters are implemented.

Reserved exports: `@threadplane/core`, `@threadplane/core/tools`, `@threadplane/core/testing`.

Core owns dependency-free agent contracts. Schema validation belongs to consumers
and their chosen libraries.

Build with `npx nx build core`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Optional and testing entry
points must remain unreachable from the root runtime and declarations.
