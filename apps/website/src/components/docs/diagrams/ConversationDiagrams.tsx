import { ExpandableDiagram } from './ExpandableDiagram';

/** Semantic HTML keeps the same reading order when these diagrams reflow on a phone. */
export function ConversationArchitecture() {
  return (
    <ExpandableDiagram
      kind="architecture"
      label="Who owns each part of a conversation"
      caption="Your application owns the experience. Threadplane connects it to the agent runtime."
      description="The application renders messages, input and tools. Angular observes agent signals; React observes an application-owned session through useAgent. The Threadplane adapter sends commands and translates streamed events. LangGraph runs the model and server tools. A checkpointer stores thread state on the server. Keeping a thread ID in the browser lets the application find that state again; it does not store the conversation itself."
    >
      <div className="tp-lesson-diagram">
        <div className="tp-architecture-tier">
          <span>Application</span>
          <div className="tp-diagram-card">
            <strong>Conversation UI</strong>
            <small>Messages, composer, tool views and local draft state</small>
          </div>
        </div>
        <div className="tp-architecture-link">
          ↓ Submit intent · ↑ Render updates
        </div>
        <div className="tp-architecture-tier">
          <span>Threadplane</span>
          <div className="tp-diagram-card" data-accent>
            <strong>Agent adapter / session</strong>
            <small>Angular signals · React snapshots</small>
          </div>
        </div>
        <div className="tp-architecture-link">
          ↓ Requests · ↑ Streamed events
        </div>
        <div className="tp-architecture-tier">
          <span>Server</span>
          <div className="tp-diagram-card">
            <strong>LangGraph runtime</strong>
            <small>Model calls, server tools and graph state</small>
          </div>
        </div>
        <div className="tp-architecture-link">
          ↓ Save checkpoints · ↑ Load state
        </div>
        <div className="tp-architecture-tier">
          <span>Persistence</span>
          <div className="tp-diagram-card">
            <strong>Thread checkpoints</strong>
            <small>Restore state with the confirmed thread ID</small>
          </div>
        </div>
      </div>
    </ExpandableDiagram>
  );
}

const turnEvents = [
  [
    'Person → Application',
    'Ask for a three-day trip plan.',
    'This starts one user turn.',
  ],
  [
    'Application → Runtime',
    'Submit a message on a confirmed thread.',
    'The adapter starts an agent run.',
  ],
  [
    'Runtime → Model / tools',
    'Plan, look up information and continue.',
    'One turn can contain several model and tool calls.',
  ],
  [
    'Runtime → Threadplane → UI',
    'Stream message and state updates.',
    'The response is built incrementally; a chunk is not a new turn.',
  ],
  [
    'Runtime → Storage',
    'Save state when the backend supports it.',
    'LangGraph checkpoints belong to the thread.',
  ],
  [
    'Threadplane → Application',
    'Show the final answer and settled status.',
    'The next user message starts the next turn.',
  ],
] as const;

export function TurnSequence() {
  return (
    <ExpandableDiagram
      kind="sequence"
      label="One user turn, from request to response"
      caption="A turn describes the interaction. A run executes the agent. Requests carry commands and events."
      description="Read top to bottom. A person asks for a trip plan. The application submits their message to a confirmed thread. An agent run can invoke a model and tools more than once. Threadplane observes streamed message and state events and the UI updates as they arrive. Persistence depends on the backend: LangGraph can save checkpoints during execution; the AG-UI protocol alone does not provide storage. When the run settles, the UI shows the answer. The next user message starts another turn; a tool result or streamed token does not."
    >
      <div className="tp-lesson-diagram">
        <div className="tp-sequence-lanes" aria-hidden="true">
          <span>Person / UI</span>
          <span>Threadplane</span>
          <span>Runtime / storage</span>
        </div>
        <ol className="tp-sequence-steps">
          {turnEvents.map(([route, action, detail], index) => (
            <li key={action}>
              <span className="tp-sequence-number" aria-hidden="true">
                {index + 1}
              </span>
              <div className="tp-sequence-event">
                <span className="tp-sequence-route">{route}</span>
                <strong>{action}</strong>
                <small>{detail}</small>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </ExpandableDiagram>
  );
}

export function RunState() {
  return (
    <ExpandableDiagram
      kind="state"
      label="Agent status and recovery"
      caption="Status describes execution. Inspect interrupts and error recovery before deciding what the user can do next."
      description="The public status values are idle, running and error. An accepted submit moves idle to running, including the wait before the first token. Completion or cancellation settles running back to idle. A failure moves to error. Only offer retry when the reported error allows it; an uncertain server outcome needs reconciliation. Interrupts and pending approvals are separate state, so idle alone does not mean a paused workflow has finished."
    >
      <div className="tp-lesson-diagram">
        <div className="tp-state-nodes">
          <div className="tp-diagram-card">
            <strong>
              <code>idle</code>
            </strong>
            <small>No active stream</small>
          </div>
          <div className="tp-diagram-card" data-accent>
            <strong>
              <code>running</code>
            </strong>
            <small>Waiting or streaming</small>
          </div>
          <div className="tp-diagram-card">
            <strong>
              <code>error</code>
            </strong>
            <small>Inspect recovery</small>
          </div>
        </div>
        <dl className="tp-state-transitions">
          <div>
            <dt>idle → running</dt>
            <dd>An accepted submit starts execution.</dd>
          </div>
          <div>
            <dt>running → idle</dt>
            <dd>
              The stream completes or is cancelled. Check for a pending
              interrupt.
            </dd>
          </div>
          <div>
            <dt>running → error</dt>
            <dd>A request or execution fails. Read the error details.</dd>
          </div>
          <div>
            <dt>error → recovery</dt>
            <dd>
              Retry only when allowed. Check an uncertain outcome before sending
              again.
            </dd>
          </div>
        </dl>
      </div>
    </ExpandableDiagram>
  );
}

export function ToolFlow() {
  return (
    <ExpandableDiagram
      kind="flow"
      label="A tool call inside a conversation turn"
      caption="The model requests an action. Your code validates, executes and returns its result."
      description="A model proposes a named tool call with arguments and a call ID. The owning runtime or client handler validates those arguments and, if the application requires approval, waits for it. The handler executes the action and returns a result for that call ID. When a follow-up is enabled, the model can use the result to answer or request another tool. A terminal tool can finish without another model call. These steps belong to the same user turn. Displaying a tool card does not itself execute a tool."
    >
      <div className="tp-lesson-diagram">
        <ol className="tp-tool-flow">
          <li className="tp-diagram-card">
            <strong>1. Request a tool</strong>
            <small>Name + arguments + call ID</small>
          </li>
          <li className="tp-diagram-card">
            <strong>2. Validate and approve</strong>
            <small>Application rules determine what may execute</small>
          </li>
          <li className="tp-diagram-card" data-accent>
            <strong>3. Execute in the owning environment</strong>
            <small>
              A server tool runs on the server; a client tool runs in the
              application
            </small>
          </li>
          <li className="tp-diagram-card">
            <strong>4. Return the result</strong>
            <small>Associate the result with the original call ID</small>
          </li>
          <li className="tp-diagram-card">
            <strong>5. Continue when needed</strong>
            <small>
              Request a model follow-up, or finish with a terminal result
            </small>
          </li>
        </ol>
        <p className="tp-tool-loop">
          ↳ Another tool call returns to step 1 within the same turn.
        </p>
      </div>
    </ExpandableDiagram>
  );
}

export function PersistenceModel() {
  return (
    <ExpandableDiagram
      kind="erd"
      label="Threads, runs and checkpoints"
      caption="Conceptual LangGraph relationships. These boxes are responsibilities, not a database schema to copy."
      description="The application stores a reference to a confirmed thread ID. One thread can have many runs and many checkpoints. A run advances graph execution and can produce multiple checkpoints. A checkpoint stores graph state, including messages, and may point to a parent checkpoint. Reloading with a confirmed thread ID restores its saved state. Saving that identifier in browser storage alone does not persist messages or guarantee recovery of an interrupted run."
    >
      <div className="tp-lesson-diagram">
        <div className="tp-erd">
          <div className="tp-diagram-card">
            <strong>Application reference</strong>
            <small>threadId · application owner</small>
          </div>
          <div className="tp-diagram-card" data-accent>
            <strong>Thread</strong>
            <small>thread_id · conversation identity</small>
          </div>
          <div className="tp-diagram-card">
            <strong>Run</strong>
            <small>run_id · thread_id</small>
          </div>
          <div className="tp-diagram-card">
            <strong>Checkpoint</strong>
            <small>checkpoint_id · state · parent</small>
          </div>
        </div>
        <div className="tp-erd-relations">
          <p>
            Application reference → <span>one confirmed thread</span>
          </p>
          <p>
            Thread 1 → 0…many runs <span>over its lifetime</span>
          </p>
          <p>
            Thread 1 → 0…many checkpoints <span>as graph state is saved</span>
          </p>
          <p>
            Checkpoint → <span>saved messages and application state</span>
          </p>
        </div>
      </div>
    </ExpandableDiagram>
  );
}
