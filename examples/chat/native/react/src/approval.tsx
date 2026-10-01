import { ApprovalCard } from '@threadplane/react/chat';
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
    <ApprovalCard
      className="approval"
      disabled={!canRespond}
      actions={[
        {
          id: 'approve',
          label: 'Approve request',
          onSelect: () => application.respond(token, 'approve'),
        },
        {
          id: 'decline',
          label: 'Decline request',
          onSelect: () => application.respond(token, 'decline'),
        },
      ]}
    >
      <p className="approval-reason">{reason}</p>
    </ApprovalCard>
  );
}
