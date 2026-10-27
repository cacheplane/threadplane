// libs/ag-ui/src/lib/testing/provide-fake-agent.spec.ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { EventType, type BaseEvent } from '@ag-ui/client';
import { AGENT, injectAgent } from '../provide-agent';
import { provideFakeAgent } from './provide-fake-agent';

afterEach(() => {
  TestBed.resetTestingModule();
});

describe('provideFakeAgent', () => {
  it('registers AGENT with a Fake-backed Agent', () => {
    TestBed.configureTestingModule({ providers: provideFakeAgent() });
    const agent = TestBed.inject(AGENT);
    expect(agent).toBeDefined();
    expect(typeof agent.submit).toBe('function');
  });

  it('passes tokens and delayMs through to FakeAgent', () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({ tokens: ['a'], delayMs: 1 }),
    });
    const agent = TestBed.inject(AGENT);
    expect(agent).toBeDefined();
  });
});

describe('provideFakeAgent — script', () => {
  it('reduces a scripted tool call into toolCalls()', async () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({
        delayMs: 0,
        script: [
          {
            when: 'initial',
            events: [
              {
                type: EventType.TOOL_CALL_START,
                toolCallId: 'tool-1',
                toolCallName: 'get_weather',
              } as BaseEvent,
              {
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: 'tool-1',
                delta: '{"city":"SF"}',
              } as BaseEvent,
              { type: EventType.TOOL_CALL_END, toolCallId: 'tool-1' } as BaseEvent,
            ],
          },
        ],
      }),
    });

    const agent = TestBed.runInInjectionContext(() => injectAgent());
    await agent.submit({ message: 'weather?' });

    expect(agent.toolCalls()).toHaveLength(1);
    expect(agent.toolCalls()[0]).toMatchObject({
      name: 'get_weather',
      args: { city: 'SF' },
    });
  });

  // Mirrors the fence in apps/website/content/docs/ag-ui/guides/testing.mdx.
  it('reduces scripted state and custom events', async () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({
        delayMs: 0,
        script: [
          {
            when: 'initial',
            events: [
              {
                type: EventType.STATE_SNAPSHOT,
                snapshot: { topic: 'billing' },
              } as BaseEvent,
              {
                type: EventType.CUSTOM,
                name: 'analysis_progress',
                value: { pct: 100 },
              } as BaseEvent,
            ],
          },
        ],
      }),
    });

    const agent = TestBed.runInInjectionContext(() => injectAgent());
    await agent.submit({ message: 'find docs' });

    expect(agent.state()).toMatchObject({ topic: 'billing' });
    expect(agent.customEvents()).toContainEqual({
      name: 'analysis_progress',
      data: { pct: 100 },
    });
  });

  it('reduces a scripted CUSTOM on_interrupt into interrupt()', async () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({
        delayMs: 0,
        script: [
          {
            when: 'initial',
            events: [
              {
                type: EventType.CUSTOM,
                name: 'on_interrupt',
                value: { kind: 'approval', amount: 42 },
              } as BaseEvent,
            ],
          },
        ],
      }),
    });

    const agent = TestBed.runInInjectionContext(() => injectAgent());
    await agent.submit({ message: 'transfer' });

    expect(agent.interrupt()?.value).toEqual({ kind: 'approval', amount: 42 });
  });

  it('emits the scripted run on rawEvents$ in order and completes on destroy', async () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({
        delayMs: 0,
        script: [
          {
            when: 'initial',
            events: [
              {
                type: EventType.STATE_SNAPSHOT,
                snapshot: { topic: 'billing' },
              } as BaseEvent,
              {
                type: EventType.CUSTOM,
                name: 'analysis_progress',
                value: { pct: 100 },
              } as BaseEvent,
            ],
          },
        ],
      }),
    });

    const agent = TestBed.runInInjectionContext(() => injectAgent());
    const types: string[] = [];
    let completed = false;
    agent.rawEvents$.subscribe({
      next: (event) => types.push(event.type),
      complete: () => { completed = true; },
    });
    await agent.submit({ message: 'find docs' });

    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.CUSTOM,
      EventType.RUN_FINISHED,
    ]);

    TestBed.resetTestingModule();
    expect(completed).toBe(true);
  });

  it('runs the { toolMessageFor } branch on the follow-up carrying the tool result', async () => {
    TestBed.configureTestingModule({
      providers: provideFakeAgent({
        delayMs: 0,
        script: [
          {
            when: 'initial',
            events: [
              {
                type: EventType.TOOL_CALL_START,
                toolCallId: 'tool-1',
                toolCallName: 'get_weather',
              } as BaseEvent,
              {
                type: EventType.TOOL_CALL_ARGS,
                toolCallId: 'tool-1',
                delta: '{"city":"SF"}',
              } as BaseEvent,
              { type: EventType.TOOL_CALL_END, toolCallId: 'tool-1' } as BaseEvent,
            ],
          },
          {
            when: { toolMessageFor: 'tool-1' },
            events: [
              {
                type: EventType.TEXT_MESSAGE_START,
                messageId: 'assistant-2',
                role: 'assistant',
              } as BaseEvent,
              {
                type: EventType.TEXT_MESSAGE_CONTENT,
                messageId: 'assistant-2',
                delta: 'It is 70F in SF.',
              } as BaseEvent,
              { type: EventType.TEXT_MESSAGE_END, messageId: 'assistant-2' } as BaseEvent,
            ],
          },
        ],
      }),
    });

    const agent = TestBed.runInInjectionContext(() => injectAgent());
    agent.clientTools.setCatalog([
      {
        name: 'get_weather',
        description: 'Returns current weather.',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ]);

    await agent.submit({ message: 'weather?' });
    expect(agent.clientTools.pending()).toHaveLength(1);

    // Handing back the tool result re-runs the agent with a tool message in
    // history, which is what the { toolMessageFor } branch matches on.
    // resolve() starts that continuation without awaiting it.
    agent.clientTools.resolve('tool-1', { ok: true, value: { temp: 70 } });

    await vi.waitFor(() => {
      expect(agent.messages().at(-1)).toMatchObject({
        role: 'assistant',
        content: 'It is 70F in SF.',
      });
    });
  });
});
