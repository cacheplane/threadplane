import {
  AbstractAgent,
  EventType,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { Observable } from 'rxjs';

/**
 * Deterministic event branches for {@link FakeAgent}, reachable through the
 * constructor and through `provideFakeAgent({ script })`.
 *
 * Each branch supplies a raw AG-UI event sequence — tool calls, state
 * snapshots, custom events, anything the protocol defines. `when: 'initial'`
 * matches a turn whose history carries no tool result; `{ toolMessageFor: id }`
 * matches the follow-up turn whose history carries a tool result for that tool
 * call id. The first matching branch wins, and its `events` are wrapped in
 * `RUN_STARTED` / `RUN_FINISHED`. When no branch matches, the canned token
 * reply is streamed instead.
 */
export type FakeAgentScript = readonly {
  when: 'initial' | { toolMessageFor: string };
  events: readonly BaseEvent[];
}[];

type FakeAgentScriptWhen = FakeAgentScript[number]['when'];

/**
 * In-process AG-UI agent that emits a canned streaming response.
 *
 * Use for offline demos and tests where a real backend isn't available.
 * Echoes a fixed assistant reply token-by-token with realistic timing.
 *
 * NOT for production use.
 */
export class FakeAgent extends AbstractAgent {
  /**
   * Tokens streamed back as the assistant reply. Override with custom
   * tokens via the constructor for varied demo content.
   */
  private readonly tokens: string[];

  /** Optional reasoning chunks emitted before the text reply. */
  private readonly reasoningTokens: string[];

  /** Milliseconds between successive token emissions. */
  private readonly delayMs: number;

  /** Optional deterministic event branches for tests that need exact streams. */
  private readonly script: FakeAgentScript;

  constructor(opts: {
    tokens?: string[];
    /** Optional reasoning chunks emitted before the text reply. */
    reasoningTokens?: string[];
    delayMs?: number;
    script?: FakeAgentScript;
  } = {}) {
    super();
    this.tokens = opts.tokens ?? [
      'Hello', ' from', ' the', ' fake', ' AG-UI', ' agent.',
      ' This', ' is', ' a', ' canned', ' streaming', ' reply.',
    ];
    this.reasoningTokens = opts.reasoningTokens ?? [];
    this.delayMs = opts.delayMs ?? 60;
    this.script = opts.script ?? [];
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    const scripted = this.scriptedSequence(input);
    if (scripted) return this.emitSequence(scripted, 30);

    const tokens = this.tokens;
    const reasoningTokens = this.reasoningTokens;
    const messageId = `fake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const sequence: BaseEvent[] = [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent,
    ];

    if (reasoningTokens.length > 0) {
      // The protocol sends reasoning as a record of its own: its own id, and
      // the `reasoning` role. A session attaches it to the answer that follows.
      const reasoningId = `${messageId}-reasoning`;
      sequence.push({ type: EventType.REASONING_MESSAGE_START, messageId: reasoningId, role: 'reasoning' } as BaseEvent);
      for (const delta of reasoningTokens) {
        sequence.push({ type: EventType.REASONING_MESSAGE_CONTENT, messageId: reasoningId, delta } as BaseEvent);
      }
      sequence.push({ type: EventType.REASONING_MESSAGE_END, messageId: reasoningId } as BaseEvent);
    }

    sequence.push({ type: EventType.TEXT_MESSAGE_START, messageId, role: 'assistant' } as BaseEvent);
    for (const delta of tokens) {
      sequence.push({ type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta } as BaseEvent);
    }
    sequence.push({ type: EventType.TEXT_MESSAGE_END, messageId } as BaseEvent);
    sequence.push({ type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent);

    return this.emitSequence(sequence, 30);
  }

  private scriptedSequence(input: RunAgentInput): BaseEvent[] | undefined {
    if (this.script.length === 0) return undefined;
    const branch = this.script.find((candidate) => matchesBranch(candidate.when, input));
    if (!branch) return undefined;
    return [
      { type: EventType.RUN_STARTED, threadId: input.threadId, runId: input.runId } as BaseEvent,
      ...branch.events,
      { type: EventType.RUN_FINISHED, threadId: input.threadId, runId: input.runId } as BaseEvent,
    ];
  }

  private emitSequence(sequence: readonly BaseEvent[], initialDelayMs: number): Observable<BaseEvent> {
    const delayMs = this.delayMs;
    return new Observable<BaseEvent>((observer) => {
      let cancelled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      let i = 0;

      const emitNext = () => {
        if (cancelled) return;
        if (i >= sequence.length) {
          observer.complete();
          return;
        }
        observer.next(sequence[i]);
        i++;
        // Steady cadence except a tiny initial delay before RUN_STARTED.
        timer = setTimeout(emitNext, delayMs);
      };

      timer = setTimeout(emitNext, initialDelayMs);

      return () => {
        cancelled = true;
        if (timer !== undefined) clearTimeout(timer);
      };
    });
  }
}

function matchesBranch(when: FakeAgentScriptWhen, input: RunAgentInput): boolean {
  if (when === 'initial') return !hasToolMessages(input);
  return hasToolMessageFor(input, when.toolMessageFor);
}

function hasToolMessages(input: RunAgentInput): boolean {
  return (input.messages ?? []).some((message) => isToolMessage(message));
}

function hasToolMessageFor(input: RunAgentInput, toolCallId: string): boolean {
  return (input.messages ?? []).some((message) => {
    if (!isToolMessage(message)) return false;
    const record = message as Record<string, unknown>;
    return record['toolCallId'] === toolCallId || record['tool_call_id'] === toolCallId;
  });
}

function isToolMessage(message: unknown): boolean {
  const record = message as Record<string, unknown>;
  return record['role'] === 'tool' || record['type'] === 'tool';
}
