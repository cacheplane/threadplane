import { Fragment, useCallback, useRef, useState, type ReactNode } from 'react';
import type {
  AgentInterrupt,
  AgentInterruptResponse,
  AgentSession,
  PlainValue,
} from '@threadplane/core';

/** Answers one pending interrupt from the view `renderInterrupt` returns. */
export interface InterruptResponder {
  /** Resolves this interrupt, with the value the backend expects for it. */
  resolve(value?: PlainValue): void;
  /** Cancels this interrupt, where the backend supports cancelling. */
  cancel(): void;
  /** True once this interrupt has an answer that waits on the other pending ones. */
  readonly answered: boolean;
  /** True while the answers are being sent; disable the controls. */
  readonly sending: boolean;
}

/** Draws one pending interrupt. Return `null` to show nothing for it. */
export type RenderInterrupt = (
  interrupt: AgentInterrupt,
  respond: InterruptResponder
) => ReactNode;

interface Collected {
  /** The pause these answers belong to: the snapshot's `interrupts` list. */
  readonly pause: readonly AgentInterrupt[];
  readonly answers: ReadonlyMap<string, AgentInterruptResponse>;
  readonly sending: boolean;
}

function report(error: unknown, onError?: (error: unknown) => void): void {
  if (onError) onError(error);
  // An unhandled failure must not be silent.
  else
    (globalThis as { reportError?: (error: unknown) => void }).reportError?.(
      error
    );
}

/**
 * The views for a session's pending interrupts, or undefined when there is
 * nothing to show. Each answer is held until every pending interrupt has one;
 * they are then sent together with one `session.resume`, because a paused run
 * continues once. A new pause starts with no answers. If `resume` rejects, the
 * answers are dropped so the person can answer again, and the failure goes to
 * `onError`.
 */
export function useSessionInterrupts(
  session: AgentSession,
  interrupts: readonly AgentInterrupt[] | undefined,
  render: RenderInterrupt | undefined,
  onError?: (error: unknown) => void
): ReactNode | undefined {
  const [collected, setCollected] = useState<Collected>();
  const current =
    collected && collected.pause === interrupts ? collected : undefined;
  // The latest values for callbacks a view may keep past this render.
  const live = useRef({ session, interrupts, current, onError });
  live.current = { session, interrupts, current, onError };

  const answer = useCallback((response: AgentInterruptResponse) => {
    const { session, interrupts, current, onError } = live.current;
    if (!interrupts?.length || current?.sending) return;
    if (!interrupts.some((entry) => entry.id === response.interruptId)) return;
    const answers = new Map(current?.answers);
    answers.set(response.interruptId, response);
    const complete = interrupts.every((entry) => answers.has(entry.id));
    const next = { pause: interrupts, answers, sending: complete };
    live.current = { ...live.current, current: next };
    setCollected(next);
    if (!complete) return;
    const responses = interrupts.map(
      (entry) => answers.get(entry.id) as AgentInterruptResponse
    );
    const failed = (error: unknown) => {
      // Answerable again, unless a newer pause has already replaced this one.
      setCollected((latest) => (latest === next ? undefined : latest));
      report(error, onError);
    };
    try {
      const run = session.resume?.(responses);
      if (!run) throw new TypeError('This session cannot resume.');
      run.then(
        () => setCollected((latest) => (latest === next ? undefined : latest)),
        failed
      );
    } catch (error) {
      failed(error);
    }
  }, []);

  if (!render || !interrupts?.length || !session.resume) return undefined;
  const sending = current?.sending ?? false;
  const views = interrupts.map((interrupt) => {
    const view = render(interrupt, {
      resolve: (value) =>
        answer({
          interruptId: interrupt.id,
          status: 'resolved',
          ...(value !== undefined && { value }),
        }),
      cancel: () => answer({ interruptId: interrupt.id, status: 'cancelled' }),
      answered: current?.answers.has(interrupt.id) ?? false,
      sending,
    });
    return view == null || view === false ? null : (
      <Fragment key={interrupt.id}>{view}</Fragment>
    );
  });
  return views.some((view) => view !== null) ? <>{views}</> : undefined;
}
