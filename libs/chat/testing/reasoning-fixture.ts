// libs/chat/testing/reasoning-fixture.ts
//
// Provider-neutral fixture for the reasoning conformance test. Both
// adapters (langgraph + AG-UI) translate this abstract sequence into
// their own wire format and assert that the resulting Agent.messages()
// produces a single assistant Message with the expected reasoning
// string, response content, and a numeric (>= 0) reasoningDurationMs.
//
// "Abstract events" mirror the AG-UI shape — REASONING_*/TEXT_*. Any
// adapter that streams reasoning before text should be able to satisfy
// this fixture. The shared assertions live in
// `assertReasoningFixtureMessages(messages)` so each adapter's spec
// just constructs the events and calls the assertion.

import type { Message } from '@threadplane/chat';

/** Shared assistant message identifier for adapter reasoning conformance fixtures. */
export const REASONING_FIXTURE_MESSAGE_ID = 'fixture-msg-1';
/** Expected accumulated reasoning text for the shared adapter conformance fixture. */
export const REASONING_FIXTURE_REASONING = 'I read the prompt and decided to greet the user.';
/** Expected assistant response text for the shared adapter conformance fixture. */
export const REASONING_FIXTURE_RESPONSE = 'Hello!';

/** A provider-neutral reasoning or response-text event used by adapter conformance fixtures. */
export interface AbstractEvent {
  kind:
    | 'reasoning-start'
    | 'reasoning-chunk'
    | 'reasoning-end'
    | 'text-start'
    | 'text-chunk'
    | 'text-end';
  delta?: string;
}

/**
 * Canonical sequence: reasoning starts, three reasoning chunks, reasoning
 * ends, text starts, three text chunks, text ends.
 */
export const REASONING_FIXTURE_EVENTS: AbstractEvent[] = [
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
];

/**
 * Assertion — common to both adapters. Throws if the produced messages
 * don't match the shared expectation.
 */
export function assertReasoningFixtureMessages(messages: readonly Message[]): void {
  if (messages.length !== 1) {
    throw new Error(`Expected exactly 1 message, got ${messages.length}: ${JSON.stringify(messages)}`);
  }
  const m = messages[0];
  if (m.role !== 'assistant') {
    throw new Error(`Expected assistant role, got ${m.role}`);
  }
  if (m.content !== REASONING_FIXTURE_RESPONSE) {
    throw new Error(`Expected content ${JSON.stringify(REASONING_FIXTURE_RESPONSE)}, got ${JSON.stringify(m.content)}`);
  }
  if (m.reasoning !== REASONING_FIXTURE_REASONING) {
    throw new Error(`Expected reasoning ${JSON.stringify(REASONING_FIXTURE_REASONING)}, got ${JSON.stringify(m.reasoning)}`);
  }
  if (typeof m.reasoningDurationMs !== 'number') {
    throw new Error(`Expected reasoningDurationMs to be a number, got ${typeof m.reasoningDurationMs}`);
  }
  if (m.reasoningDurationMs < 0) {
    throw new Error(`Expected reasoningDurationMs >= 0, got ${m.reasoningDurationMs}`);
  }
}
