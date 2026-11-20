import type { CompleteOutcome } from '@threadplane/core';
import type { LangGraphRunOptions } from '@threadplane/langgraph';
import type { DemoAgent } from './agent-ref';

/** The session's regenerate command, with the LangGraph run options a submit takes. */
export type Regenerate = (
  messageId: string,
  options?: LangGraphRunOptions,
) => Promise<CompleteOutcome>;
type Checkpoints = ReturnType<DemoAgent['checkpoints']>;

/** How long a regenerate waits for the history page of the run it answers again. */
export const HISTORY_WAIT_MS = 2000;
const POLL_MS = 25;

/** Whether a saved checkpoint's state already holds the message with this id. */
function holds(checkpoint: NonNullable<Checkpoints>[number], messageId: string): boolean {
  const messages = checkpoint.values['messages'];
  return (
    Array.isArray(messages) &&
    messages.some(
      (message) =>
        typeof message === 'object' &&
        message !== null &&
        (message as { id?: unknown }).id === messageId,
    )
  );
}

/**
 * The newest loaded checkpoint that does not hold the prompt yet: the point a
 * run must start from to answer that prompt again. `checkpoints` is the
 * agent's page, oldest first.
 */
export function checkpointBefore(checkpoints: Checkpoints, promptId: string): string | undefined {
  if (!checkpoints) return undefined;
  for (let index = checkpoints.length - 1; index >= 0; index--) {
    const checkpoint = checkpoints[index];
    if (checkpoint.id && !holds(checkpoint, promptId)) return checkpoint.id;
  }
  return undefined;
}

/**
 * Regenerate for the demo agent: answers the prompt behind an assistant
 * message again by starting a run from the checkpoint saved before that
 * prompt (`run.checkpointId`). The thread gains a branch there, the earlier
 * answer stays on the old one, and the transcript shows the new answer.
 *
 * This stands in for the session's own `regenerate`, which cannot be used
 * against a LangGraph deployment today. That command forks from the same
 * checkpoint, and a fork requires a checkpoint with no work pending; the
 * checkpoint saved before a prompt is always the run's `input` checkpoint,
 * whose `next` is `['__start__']`, so the fork is refused. A run from a
 * checkpoint has no such requirement. Remove this once the session's command
 * accepts that checkpoint.
 *
 * `submit` is the shell's submit, so the new run carries the current model
 * selection like any other message. Only the prompt's text is sent again.
 */
export function regenerateFromCheckpoint(
  agent: Pick<DemoAgent, 'messages' | 'status' | 'checkpoints'>,
  submit: DemoAgent['submit'],
  waitMs = HISTORY_WAIT_MS,
): Regenerate {
  return async (messageId, options) => {
    if (agent.status() === 'running') {
      throw new Error('Cannot regenerate while a response is running.');
    }
    const messages = agent.messages();
    const at = messages.findIndex((message) => message.id === messageId);
    if (at < 0 || messages[at].role !== 'assistant') {
      throw new Error('Regenerate needs the id of an assistant message.');
    }
    let prompt: (typeof messages)[number] | undefined;
    for (let index = at - 1; index >= 0 && !prompt; index--) {
      if (messages[index].role === 'user') prompt = messages[index];
    }
    if (!prompt) throw new Error('No prompt precedes that message.');

    // The session reads the history page again when a run ends. A regenerate
    // asked for straight after the answer can arrive before that read, so wait
    // (briefly) for a page that knows the prompt's run.
    const promptId = prompt.id;
    const known = () => agent.checkpoints()?.some((checkpoint) => holds(checkpoint, promptId)) === true;
    const deadline = Date.now() + waitMs;
    while (!known() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_MS));
    }
    if (agent.status() === 'running' || agent.messages().every((message) => message.id !== messageId)) {
      throw new Error('The conversation changed before it could be regenerated.');
    }
    const checkpointId = checkpointBefore(agent.checkpoints(), promptId);
    if (!checkpointId) {
      throw new Error('The checkpoint before that prompt is not in the loaded history.');
    }
    return submit(
      { message: prompt.content },
      { ...options, run: { ...options?.run, checkpointId } },
    );
  };
}
