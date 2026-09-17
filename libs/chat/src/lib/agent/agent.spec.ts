import { signal } from '@angular/core';
import type { Agent } from './agent';

describe('Agent interface', () => {
  it('accepts a minimal implementation without optional capabilities', () => {
    const agent: Agent = {
      messages: signal([]),
      status: signal('idle'),
      isLoading: signal(false),
      error: signal(undefined),
      toolCalls: signal([]),
      state: signal({}),
      submit: async () => Promise.resolve(),
      stop: async () => Promise.resolve(),
      retry: async () => Promise.resolve(),
    };
    expect(agent.status()).toBe('idle');
  });

  it('accepts an implementation with interrupts and subagents', () => {
    const agent: Agent = {
      messages: signal([]),
      status: signal('idle'),
      isLoading: signal(false),
      error: signal(undefined),
      toolCalls: signal([]),
      state: signal({}),
      interrupt: signal(undefined),
      subagents: signal(new Map()),
      submit: async () => Promise.resolve(),
      stop: async () => Promise.resolve(),
      retry: async () => Promise.resolve(),
    };
    expect(agent.interrupt?.()).toBeUndefined();
  });
});

// These two cases document how an optional capability is used; they cannot
// catch its removal, because vitest does not type-check. The regression guard
// for the contract itself is `_checkStatus` in agent-error.type-spec.ts, which
// the `type-tests` target compiles.
describe('Agent.checkStatus', () => {
  const base = (): Agent => ({
    messages: signal([]),
    status: signal('idle'),
    isLoading: signal(false),
    error: signal(undefined),
    toolCalls: signal([]),
    state: signal({}),
    submit: async () => Promise.resolve(),
    stop: async () => Promise.resolve(),
    retry: async () => Promise.resolve(),
  });

  it('is optional — an agent without it still satisfies the contract', () => {
    expect(base().checkStatus).toBeUndefined();
  });

  it('is callable when a runtime provides one', async () => {
    let calls = 0;
    const agent: Agent = { ...base(), checkStatus: async () => { calls++; } };
    await agent.checkStatus?.();
    expect(calls).toBe(1);
  });
});
