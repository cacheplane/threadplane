import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { injectAgent } from '@threadplane/angular';
import { appConfig } from './app.config';
import { ITINERARY_AGENT } from './client-tools';

/** Answers every run with an empty successful stream and keeps its thread id. */
function servingAgent() {
  const threads: string[] = [];
  const fetch = vi.fn(async (_url: unknown, init?: RequestInit) => {
    const input = JSON.parse(String(init?.body)) as { threadId: string; runId: string };
    threads.push(input.threadId);
    const ids = { threadId: input.threadId, runId: input.runId };
    return new Response(
      [
        { type: 'RUN_STARTED', ...ids },
        { type: 'RUN_FINISHED', ...ids },
      ]
        .map((event) => `data: ${JSON.stringify(event)}\n\n`)
        .join(''),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  });
  vi.stubGlobal('fetch', fetch);
  return threads;
}

describe('the application agent (app.config.ts)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('carries the thread id of a new conversation after its first run', async () => {
    const threads = servingAgent();
    TestBed.configureTestingModule({ providers: appConfig.providers });
    const agent = TestBed.runInInjectionContext(() => injectAgent(ITINERARY_AGENT));

    await expect(agent.submit('say hi briefly')).resolves.toBe('success');

    // The session named the thread; the agent must know the same id, or
    // agent.threadId() stays null and nothing can address the conversation.
    expect(threads).toHaveLength(1);
    expect(threads[0]).toEqual(expect.any(String));
    expect(threads[0]).not.toBe('');
    expect(agent.threadId()).toBe(threads[0]);

    // The next run continues the same thread.
    await expect(agent.submit('and again')).resolves.toBe('success');
    expect(threads).toEqual([agent.threadId(), agent.threadId()]);
  });
});
