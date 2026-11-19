import { Fragment, useLayoutEffect, useState } from 'react';
import type { RenderReadinessEntry, RenderViewProps } from './types.js';
import { RenderDevtoolsMark } from './devtools.js';

declare const process: { readonly env: { readonly NODE_ENV?: string } };

interface Contract {
  readonly elementKey: string;
  readonly type: string;
  readonly component: RenderReadinessEntry['component'];
  readonly isReady: RenderReadinessEntry['isReady'];
}
interface Committed {
  readonly contract: Contract;
  readonly generation: number;
  readonly mounted: boolean;
}
function sameContract(left: Contract, right: Contract): boolean {
  return (
    left.elementKey === right.elementKey &&
    left.type === right.type &&
    left.component === right.component &&
    left.isReady === right.isReady
  );
}

function admit(
  entry: RenderReadinessEntry,
  props: RenderViewProps['props']
): boolean {
  if (typeof entry.isReady !== 'function')
    throw new TypeError('Render readiness isReady must be a function.');
  const result = entry.isReady(props);
  if (typeof result !== 'boolean')
    throw new TypeError(
      'Render readiness isReady must return a synchronous boolean.'
    );
  return result;
}

/** A gate is unmounted by the renderer's normal missing/hidden/direct paths. */
export function ReadinessGate({
  entry,
  type,
  ...view
}: RenderViewProps & {
  readonly entry: RenderReadinessEntry;
  readonly type: string;
}) {
  const contract: Contract = {
    elementKey: view.elementKey,
    type,
    component: entry.component,
    isReady: entry.isReady,
  };
  // A first render that is ready starts admitted, so the real view renders once
  // rather than again from the layout effect. An abandoned mount discards it.
  const [committed, setCommitted] = useState<Committed>(() => ({
    contract,
    generation: 0,
    mounted: admit(entry, view.props),
  }));
  const unchanged = sameContract(committed.contract, contract);
  const generation = committed.generation + (unchanged ? 0 : 1);
  let ready = unchanged && committed.mounted;
  if (!ready) ready = admit(entry, view.props);
  // Only a successful commit of this subtree records admission. Suspended or
  // abandoned candidates cannot latch; a committed pending contract retires A.
  useLayoutEffect(() => {
    if (!unchanged || committed.mounted !== ready)
      setCommitted({ contract, generation, mounted: ready });
  });
  const pending: RenderViewProps = {
    props: view.props,
    bindings: view.bindings,
    elementKey: view.elementKey,
    loading: view.loading,
  };
  const Component = entry.component;
  const Fallback = entry.fallback;
  // Development only: the DevTools render report (see ./devtools.tsx).
  const mark =
    process.env.NODE_ENV !== 'production' ? (
      <RenderDevtoolsMark
        elementKey={view.elementKey}
        state={ready ? 'mounted' : 'fallback'}
      />
    ) : null;
  return ready ? (
    <Fragment key={`real:${generation}`}>
      {mark}
      <Component {...view} />
    </Fragment>
  ) : (
    <Fragment key={`pending:${generation}`}>
      {mark}
      {Fallback ? <Fallback {...pending} /> : null}
    </Fragment>
  );
}
