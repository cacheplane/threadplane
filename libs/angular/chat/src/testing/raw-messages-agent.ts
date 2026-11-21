import { signal, type WritableSignal } from '@angular/core';
import type { Message } from '../lib/agent';
import { mockAgent, type MockAgent, type MockAgentOptions } from '../lib/testing/mock-agent';

/** A {@link MockAgent} whose `messages` signal holds exactly the objects a spec gives it. */
export type RawMessagesAgent = Omit<MockAgent, 'messages'> & {
  readonly messages: WritableSignal<Message[]>;
};

/**
 * Spec support, not part of the package. `mockAgent()` publishes owned, frozen
 * copies, as a session does. The specs that measure how `<chat>` treats the
 * message objects themselves need the opposite: the same object published
 * again, an object edited in place and re-notified, wrappers that keep or lose
 * their identity between publishes. This agent keeps the mock's commands and
 * every other field, and holds `messages` in a plain signal that neither
 * copies nor freezes.
 *
 * `submit` still records on the fake session and does not append here.
 */
export function rawMessagesAgent(
  options: Omit<MockAgentOptions, 'messages'> & { readonly messages?: Message[] } = {},
): RawMessagesAgent {
  const { messages = [], ...rest } = options;
  const agent = mockAgent(rest);
  // Assigned in place, so the mock's call-log getters stay live.
  return Object.assign(agent, { messages: signal<Message[]>(messages) }) as unknown as RawMessagesAgent;
}
