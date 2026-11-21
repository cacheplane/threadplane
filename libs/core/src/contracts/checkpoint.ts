import type { PlainValue } from './tool.js';

/**
 * One point in a session's saved history, with the state the backend held
 * there. Read by timelines and state inspectors. `id` is the backend's own
 * name for the point; a view hands it back to a backend command such as a
 * fork and never interprets it.
 */
export interface AgentCheckpoint {
  /** Backend-opaque identifier, such as a LangGraph `checkpoint_id`. */
  readonly id?: string;
  /** Display text for the point, such as the next node's name. */
  readonly label?: string;
  /** The state at this point, as frozen plain data. */
  readonly values: Readonly<Record<string, PlainValue>>;
}
