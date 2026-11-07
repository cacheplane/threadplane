import { ArrowRight } from 'lucide-react';
import { ExpandableDiagram } from './ExpandableDiagram';

/** A responsive reading-order diagram: rejecting also resumes with a decision. */
export function HumanApprovalFlow() {
  return (
    <ExpandableDiagram
      kind="flow"
      label="The human approval flow"
      caption="Resuming passes the decision back to the agent. Approval and rejection are both decisions; your graph defines what happens next."
      description="The agent pauses before the proposed action. The interface presents a request for a person to review. That person's decision is sent back when the run resumes, and the graph routes based on the decision."
    >
      <div className="tp-human-approval-flow">
        <div className="tp-human-approval-node">
          <strong>Agent pauses</strong>
          <small>Proposes an action</small>
        </div>
        <ArrowRight className="tp-human-approval-arrow" aria-hidden="true" />
        <div className="tp-human-approval-node" data-accent>
          <strong>You decide</strong>
          <small>Review the request</small>
        </div>
        <ArrowRight className="tp-human-approval-arrow" aria-hidden="true" />
        <div className="tp-human-approval-node">
          <strong>Agent resumes</strong>
          <small>Uses your decision</small>
        </div>
      </div>
    </ExpandableDiagram>
  );
}
