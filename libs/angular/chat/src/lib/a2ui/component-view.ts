import type { A2uiComponent } from '@threadplane/a2ui';

/** Chat-internal projection of an A2UI component, materialized by the
 * surface store. Distinct from the wire-format `A2uiComponent` in
 * `@threadplane/a2ui` — this type adds the per-component readiness fields
 * the progressive renderer consumes. */
export interface A2uiComponentView {
  /** The component's id (same as the wire-format `A2uiComponent.id`). */
  readonly id: string;
  /** The component type — e.g. `'Button'`, `'TextField'` — matched
   * against catalog `views` entries. Mirrors the wire `component` string. */
  readonly type: string;
  /** Data model paths this component references via its `{$.path}` prop
   * expressions. Extracted once on `updateComponents` apply; immutable. */
  readonly bindings: readonly string[];
  /** Monotonic: `false` until every binding has resolved at least once
   * in the accumulated data model, then `true` forever. Once `true`,
   * subsequent `updateDataModel` envelopes push new prop values but do
   * NOT flip this back to `false`. */
  readonly ready: boolean;
  /** Resolved property bag (reserved protocol keys stripped). Meaningful
   * only when `ready === true`. */
  readonly props: Readonly<Record<string, unknown>>;
  /** The raw wire-format component, retained so the slot directive
   * can look up the catalog entry by type and resolve nested children
   * on re-renders. */
  readonly def: A2uiComponent;
}
