import type { PlanningApplicationSnapshot } from './application';
import { planProgress, type PlanItem, type PlanState } from './plan-state';
type Valid = Exclude<PlanState, { kind: 'invalid' }>;
const labels = {
  pending: 'Pending',
  in_progress: 'In progress',
  completed: 'Completed',
};
function PlanRows({ items }: { readonly items: readonly PlanItem[] }) {
  return (
    <ol className="plan-items">
      {items.map((item, index) => (
        <li key={index} data-plan-status={item.status}>
          <span className="plan-marker" aria-hidden="true">
            {item.status === 'completed' ? '✓' : index + 1}
          </span>
          <div>
            <p>{item.content || 'Untitled item'}</p>
            <span className="plan-item-status">{labels[item.status]}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
export function PlanPanel({
  observed,
  saved,
  phase,
  notice,
}: {
  readonly observed: Valid;
  readonly saved: Valid;
  readonly phase: PlanningApplicationSnapshot['phase'];
  readonly notice: string | null;
}) {
  const progress =
    observed.kind === 'valid' ? planProgress(observed.items) : undefined;
  const status =
    phase === 'saved'
      ? 'Saved plan'
      : phase === 'working' || phase === 'confirming'
      ? 'Live plan · waiting for confirmation'
      : phase === 'idle'
      ? 'Your plan'
      : phase === 'stopped'
      ? 'Stopped · last update not confirmed'
      : phase === 'failed'
      ? 'Failed response · last update not confirmed'
      : 'Unconfirmed update · last saved plan retained';
  return (
    <aside className="plan-panel" aria-label="Plan">
      <div className="plan-heading">
        <p className="eyebrow">Plan</p>
        <h2>A clear path forward</h2>
        <p className="plan-authority">{status}</p>
      </div>
      {progress && (
        <div className="plan-progress">
          <p>
            {progress.completed} of {progress.total} completed
          </p>
          <progress
            aria-label="Plan completion"
            value={progress.completed}
            max={progress.total || 1}
          />
        </div>
      )}
      {observed.kind === 'missing' ? (
        <p className="plan-empty">
          Ask the assistant to make a plan. Its full list will appear here as it
          updates.
        </p>
      ) : observed.items.length ? (
        <PlanRows items={observed.items} />
      ) : (
        <p className="plan-empty">The plan is empty.</p>
      )}
      {notice && (
        <p role="status" className="plan-notice">
          {notice}
        </p>
      )}
      {phase !== 'idle' && (
        <p className="plan-explanation">
          Item status records the assistant’s plan. “In progress” does not mean
          a response is still running.
        </p>
      )}
      {saved.kind === 'valid' && phase !== 'saved' && (
        <details className="saved-plan">
          <summary>Last saved plan</summary>
          {saved.items.length ? (
            <PlanRows items={saved.items} />
          ) : (
            <p>The saved plan is empty.</p>
          )}
        </details>
      )}
    </aside>
  );
}
