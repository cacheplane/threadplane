// The one place the library names `@threadplane/angular`.
//
// The lint rule is switched off for this line only, and only until the legacy
// adapters are deleted: `libs/langgraph/src/lib` and `libs/ag-ui/src/lib` still
// import the previous agent contract from this package, which closes a loop
// through `@threadplane/angular`'s own backend specs. Remove the directive
// together with those folders.
// eslint-disable-next-line @nx/enforce-module-boundaries
export type { Agent, AgentLifecycle } from '@threadplane/angular';
