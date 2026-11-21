import type { Message } from '../contracts/message.js';

/** One backend-neutral step of a reply that reasons before it answers. */
export interface ReasoningFixtureEvent {
  readonly kind:
    | 'reasoning-start'
    | 'reasoning-chunk'
    | 'reasoning-end'
    | 'text-start'
    | 'text-chunk'
    | 'text-end';
  readonly delta?: string;
}

/** The fixture: the steps to translate, and what they must produce. */
export interface ReasoningFixture {
  readonly messageId: string;
  /** The reasoning text the steps add up to. */
  readonly reasoning: string;
  /** The answer text the steps add up to. */
  readonly response: string;
  /** Reasoning starts, three chunks, reasoning ends; then the same for the text. */
  readonly events: readonly ReasoningFixtureEvent[];
}

const fixture: ReasoningFixture = Object.freeze({
  messageId: 'fixture-msg-1',
  reasoning: 'I read the prompt and decided to greet the user.',
  response: 'Hello!',
  events: Object.freeze(
    (
      [
        { kind: 'reasoning-start' },
        { kind: 'reasoning-chunk', delta: 'I read the prompt ' },
        { kind: 'reasoning-chunk', delta: 'and decided ' },
        { kind: 'reasoning-chunk', delta: 'to greet the user.' },
        { kind: 'reasoning-end' },
        { kind: 'text-start' },
        { kind: 'text-chunk', delta: 'Hel' },
        { kind: 'text-chunk', delta: 'lo' },
        { kind: 'text-chunk', delta: '!' },
        { kind: 'text-end' },
      ] as const
    ).map((event) => Object.freeze(event))
  ),
});

/**
 * A reply that reasons and then answers, described without any wire format.
 * Each runtime translates `events` into what its backend would send, runs
 * them through a real session, and passes the session's messages to
 * {@link assertReasoningFixtureMessages}.
 */
export function reasoningFixture(): ReasoningFixture {
  return fixture;
}

/**
 * Throws unless `messages` is what the fixture must produce: one assistant
 * message with the fixture's answer as content, its reasoning as `reasoning`,
 * and a `reasoningDurationMs` that is a number of zero or more.
 */
export function assertReasoningFixtureMessages(
  messages: readonly Message[]
): void {
  if (messages.length !== 1)
    throw new Error(
      `Expected exactly 1 message, got ${messages.length}: ${JSON.stringify(
        messages
      )}`
    );
  const [message] = messages;
  if (message.role !== 'assistant')
    throw new Error(`Expected assistant role, got ${message.role}`);
  if (message.content !== fixture.response)
    throw new Error(
      `Expected content ${JSON.stringify(
        fixture.response
      )}, got ${JSON.stringify(message.content)}`
    );
  if (message.reasoning !== fixture.reasoning)
    throw new Error(
      `Expected reasoning ${JSON.stringify(
        fixture.reasoning
      )}, got ${JSON.stringify(message.reasoning)}`
    );
  if (typeof message.reasoningDurationMs !== 'number')
    throw new Error(
      `Expected reasoningDurationMs to be a number, got ${typeof message.reasoningDurationMs}`
    );
  if (message.reasoningDurationMs < 0)
    throw new Error(
      `Expected reasoningDurationMs >= 0, got ${message.reasoningDurationMs}`
    );
}
