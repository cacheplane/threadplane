# @threadplane/react

Private, unpublished foundation scaffolding for the React parity work. The empty
root entry point provides no supported runtime API. No React bindings, stores,
renderers, or backend adapters are implemented.

The only current export is `@threadplane/react`. React rendering and feature
bindings belong to this package; feature subpaths will be added with their
implementations.

Build with `npx nx build react`. Packaging and dependency boundaries are
verified by the scripts in `scripts/react-parity`. Feature entry points must
remain unreachable from the root runtime and declarations.

The root entry point retains `use client`.
