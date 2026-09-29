import type {
  ApplicationSnapshot,
  createApplication,
} from '../../shared/application';

export function Approval({
  application,
  snapshot,
}: {
  application: ReturnType<typeof createApplication>;
  snapshot: ApplicationSnapshot;
}) {
  if (snapshot.selection.status !== 'ready') return null;
  const decision = snapshot.decision;
  if (!decision)
    return snapshot.runtime?.interrupts.length ? (
      <p role="status">
        This conversation is waiting for a response this example does not
        support.
      </p>
    ) : null;
  const { token, reason, canRespond } = decision;
  return (
    <section className="approval" aria-labelledby="approval-title">
      <h2 id="approval-title">Approval request</h2>
      <p className="approval-reason">{reason}</p>
      <div className="approval-actions">
        <button
          type="button"
          disabled={!canRespond}
          onClick={() => application.respond(token, 'approve')}
        >
          Approve request
        </button>
        <button
          type="button"
          disabled={!canRespond}
          onClick={() => application.respond(token, 'decline')}
        >
          Decline request
        </button>
      </div>
    </section>
  );
}
