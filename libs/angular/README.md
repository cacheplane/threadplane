# @threadplane/angular

Private, unpublished Angular foundation scaffolding. The empty root entry point
provides no supported runtime API or secondary entry points. Angular bindings,
providers, components, and backend integrations are not implemented.

Build with `npx nx build angular`. The production target uses ng-packagr and
partial Angular compilation to emit the Angular Package Format. Tests currently
contain no cases and pass with `passWithNoTests`; the type-tests target checks
the empty source with TypeScript.

The declared Angular peer range follows the existing workspace packages. It is
not a compatibility-matrix claim. An installed Angular CLI consumer must verify
package resolution and linking separately before this foundation is complete.
