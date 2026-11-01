import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { StateDiff, type DebugValue } from '@threadplane/react/debug';
import type { ReactApplication, ReactApplicationSnapshot } from './application';

type ObservedValues = NonNullable<
  ReactApplicationSnapshot['runtime']
>['values'];

export function ObservedStateComparison({
  application,
  threadId,
  values,
}: {
  readonly application: ReactApplication;
  readonly threadId: string;
  readonly values: ObservedValues;
}) {
  const scope = useMemo(() => ({}), [application, threadId]);
  const committed = useRef<object | null>(null);
  const [baseline, setBaseline] = useState<{
    readonly scope: object;
    readonly values: Exclude<ObservedValues, undefined>;
  } | null>(null);
  useLayoutEffect(() => {
    committed.current = scope;
    // Keep an accepted observation through same-scope StrictMode replay.
    setBaseline((previous) => (previous?.scope === scope ? previous : null));
    return () => {
      if (committed.current === scope) committed.current = null;
    };
  }, [scope]);
  const observed = baseline?.scope === scope ? baseline : null;
  const liveScope = () => {
    if (committed.current !== scope) return null;
    const live = application.getSnapshot();
    return live.selection.status === 'ready' && live.selection.id === threadId
      ? live
      : null;
  };
  const capture = () => {
    const live = liveScope();
    if (values === undefined || !live || live.runtime?.values !== values)
      return;
    // Application snapshots own immutable values; borrow this one observation.
    setBaseline({ scope, values });
  };
  const clear = () => {
    if (liveScope()) setBaseline(null);
  };
  return (
    <details className="observed-state-comparison">
      <summary>Observed state comparison</summary>
      <p className="muted">
        Compare a captured observation with the current observed state. The
        baseline stays in this view until cleared or the conversation changes;
        it is not a saved checkpoint.
      </p>
      <button type="button" onClick={capture} disabled={values === undefined}>
        Capture current state baseline
      </button>
      <button type="button" onClick={clear} disabled={!observed}>
        Clear baseline
      </button>
      {values === undefined ? (
        <p>Current observed state is unavailable.</p>
      ) : observed ? (
        // Immutable runtime PlainValue permits undefined. The passive diff
        // validates these borrowed inputs without normalizing or omitting fields.
        <StateDiff
          before={observed.values as DebugValue}
          after={values as DebugValue}
          label="Observed baseline to current state"
        />
      ) : (
        <p>No observed baseline captured.</p>
      )}
    </details>
  );
}
