// Application contract, not a Threadplane session method.
interface Decision {
  readonly token: string;
  readonly summary: string;
  readonly canRespond: boolean;
}

export function Approval({ decision, respond }: {
  decision: Decision;
  respond: (token: string, choice: 'approve' | 'decline') => void;
}) {
  return <section aria-label="Proposed action">
    <p>{decision.summary}</p>
    <button disabled={!decision.canRespond}
      onClick={() => respond(decision.token, 'approve')}>Approve</button>
    <button disabled={!decision.canRespond}
      onClick={() => respond(decision.token, 'decline')}>Decline</button>
  </section>;
}
