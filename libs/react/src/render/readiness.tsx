import { Fragment, useLayoutEffect, useState } from 'react';
import type { RenderReadinessEntry, RenderViewProps } from './types.js';

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
  const [committed, setCommitted] = useState<Committed>(() => ({
    contract,
    generation: 0,
    mounted: false,
  }));
  const unchanged = sameContract(committed.contract, contract);
  const generation = committed.generation + (unchanged ? 0 : 1);
  let ready = unchanged && committed.mounted;
  if (!ready) {
    if (typeof entry.isReady !== 'function')
      throw new TypeError('Render readiness isReady must be a function.');
    const result = entry.isReady(view.props);
    if (typeof result !== 'boolean')
      throw new TypeError(
        'Render readiness isReady must return a synchronous boolean.'
      );
    ready = result;
  }
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
  return ready ? (
    <Fragment key={`real:${generation}`}>
      <Component {...view} />
    </Fragment>
  ) : (
    <Fragment key={`pending:${generation}`}>
      {Fallback ? <Fallback {...pending} /> : null}
    </Fragment>
  );
}
