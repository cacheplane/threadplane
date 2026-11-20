import { describe, it, expect, vi } from 'vitest';
import { toArray, lastValueFrom } from 'rxjs';
import { EventType, type RunAgentInput, type BaseEvent } from '@ag-ui/client';
import { FakeAgent } from './fake-agent';

const minimalInput: RunAgentInput = {
  threadId: 't1',
  runId: 'r1',
  messages: [],
  state: {},
  tools: [],
  context: [],
  forwardedProps: {},
};

describe('FakeAgent', () => {
  it('emits RUN_STARTED then text events then RUN_FINISHED', async () => {
    const agent = new FakeAgent({ tokens: ['hi', ' there'], delayMs: 1 });
    const events = await lastValueFrom(agent.run(minimalInput).pipe(toArray()));
    const types = events.map((e: BaseEvent) => e.type);
    expect(types).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
  });

  it('streams tokens as deltas in order', async () => {
    const agent = new FakeAgent({ tokens: ['one', 'two', 'three'], delayMs: 1 });
    const events = await lastValueFrom(agent.run(minimalInput).pipe(toArray()));
    const deltas = events
      .filter((e: BaseEvent) => e.type === EventType.TEXT_MESSAGE_CONTENT)
      .map((e: any) => e.delta);
    expect(deltas).toEqual(['one', 'two', 'three']);
  });

  it('threadId and runId from input flow into RUN_STARTED and RUN_FINISHED', async () => {
    const agent = new FakeAgent({ tokens: ['x'], delayMs: 1 });
    const events = await lastValueFrom(agent.run({ ...minimalInput, threadId: 'tA', runId: 'rA' }).pipe(toArray()));
    const started = events.find((e: BaseEvent) => e.type === EventType.RUN_STARTED) as any;
    const finished = events.find((e: BaseEvent) => e.type === EventType.RUN_FINISHED) as any;
    expect(started.threadId).toBe('tA');
    expect(finished.threadId).toBe('tA');
  });

  it('cancels in-flight emissions when unsubscribed', async () => {
    vi.useFakeTimers();
    const agent = new FakeAgent({ tokens: ['a', 'b', 'c', 'd'], delayMs: 100 });
    const seen: BaseEvent[] = [];
    const sub = agent.run(minimalInput).subscribe((e: BaseEvent) => seen.push(e));
    vi.advanceTimersByTime(50);  // first emission only
    sub.unsubscribe();
    vi.advanceTimersByTime(1000);  // would have emitted everything if not cancelled
    expect(seen.length).toBeLessThan(7);
    vi.useRealTimers();
  });
});

describe('FakeAgent — reasoningTokens', () => {
  it('emits REASONING_MESSAGE_START → CONTENT × N → END before TEXT_MESSAGE_*', async () => {
    const agent = new FakeAgent({
      tokens: ['hello'],
      reasoningTokens: ['I ', 'thought ', 'about it.'],
      delayMs: 0,
    });
    const events = await lastValueFrom(
      agent.run({ threadId: 't', runId: 'r' } as any).pipe(toArray()),
    );
    const types = events.map((e) => (e as any).type);
    const startIdx = types.indexOf('REASONING_MESSAGE_START');
    const endIdx = types.indexOf('REASONING_MESSAGE_END');
    const textStartIdx = types.indexOf('TEXT_MESSAGE_START');
    expect(startIdx).toBeGreaterThan(-1);
    expect(endIdx).toBeGreaterThan(startIdx);
    expect(textStartIdx).toBeGreaterThan(endIdx);
    const contentEvents = events.filter((e: any) => e.type === 'REASONING_MESSAGE_CONTENT');
    expect(contentEvents.length).toBe(3);
    expect(contentEvents.map((e: any) => e.delta)).toEqual(['I ', 'thought ', 'about it.']);
  });

  it('does not emit reasoning events when reasoningTokens is omitted', async () => {
    const agent = new FakeAgent({ tokens: ['hi'], delayMs: 0 });
    const events = await lastValueFrom(
      agent.run({ threadId: 't', runId: 'r' } as any).pipe(toArray()),
    );
    const types = events.map((e) => (e as any).type);
    expect(types).not.toContain('REASONING_MESSAGE_START');
    expect(types).not.toContain('REASONING_MESSAGE_CONTENT');
    expect(types).not.toContain('REASONING_MESSAGE_END');
  });
});

describe('FakeAgent — scripted streams', () => {
  it('emits scripted tool-call events between RUN_STARTED and RUN_FINISHED', async () => {
    const agent = new FakeAgent({
      delayMs: 0,
      script: [{
        when: 'initial',
        events: [
          {
            type: EventType.TOOL_CALL_START,
            toolCallId: 'tool-1',
            toolCallName: 'get_weather',
            parentMessageId: 'assistant-1',
          } as BaseEvent,
          { type: EventType.TOOL_CALL_ARGS, toolCallId: 'tool-1', delta: '{"city":"SF"}' } as BaseEvent,
          { type: EventType.TOOL_CALL_END, toolCallId: 'tool-1' } as BaseEvent,
        ],
      }],
    });

    const events = await lastValueFrom(
      agent.run({ ...minimalInput, threadId: 'thread-script', runId: 'run-script' }).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      'TOOL_CALL_START',
      'TOOL_CALL_ARGS',
      'TOOL_CALL_END',
      EventType.RUN_FINISHED,
    ]);
    expect(events[0]).toMatchObject({ threadId: 'thread-script', runId: 'run-script' });
    expect(events[1]).toMatchObject({
      toolCallId: 'tool-1',
      toolCallName: 'get_weather',
      parentMessageId: 'assistant-1',
    });
    expect(events[4]).toMatchObject({ threadId: 'thread-script', runId: 'run-script' });
  });

  it('selects a continuation branch when history contains a matching tool message', async () => {
    const agent = new FakeAgent({
      delayMs: 0,
      script: [
        {
          when: 'initial',
          events: [
            { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolCallName: 'get_weather' } as BaseEvent,
            { type: 'TOOL_CALL_END', toolCallId: 'tool-1' } as BaseEvent,
          ],
        },
        {
          when: { toolMessageFor: 'tool-1' },
          events: [
            { type: EventType.TEXT_MESSAGE_START, messageId: 'assistant-2', role: 'assistant' } as BaseEvent,
            { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'assistant-2', delta: 'continued' } as BaseEvent,
            { type: EventType.TEXT_MESSAGE_END, messageId: 'assistant-2' } as BaseEvent,
          ],
        },
      ],
    });

    const events = await lastValueFrom(
      agent.run({
        ...minimalInput,
        messages: [{ role: 'tool', toolCallId: 'tool-1', content: '{"temp":70}' }] as never,
      }).pipe(toArray()),
    );

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.TEXT_MESSAGE_START,
      EventType.TEXT_MESSAGE_CONTENT,
      EventType.TEXT_MESSAGE_END,
      EventType.RUN_FINISHED,
    ]);
    expect(events[2]).toMatchObject({ delta: 'continued' });
  });

  it('emits scripted RUN_ERROR, STATE_SNAPSHOT, and CUSTOM interrupt events', async () => {
    const interrupt = { kind: 'approval', amount: 42 };
    const agent = new FakeAgent({
      delayMs: 0,
      script: [{
        when: 'initial',
        events: [
          { type: EventType.STATE_SNAPSHOT, snapshot: { fresh: 1 } } as BaseEvent,
          { type: EventType.CUSTOM, name: 'on_interrupt', value: interrupt } as BaseEvent,
          { type: EventType.RUN_ERROR, message: 'boom' } as BaseEvent,
        ],
      }],
    });

    const events = await lastValueFrom(agent.run(minimalInput).pipe(toArray()));

    expect(events.map((e) => e.type)).toEqual([
      EventType.RUN_STARTED,
      EventType.STATE_SNAPSHOT,
      EventType.CUSTOM,
      EventType.RUN_ERROR,
      EventType.RUN_FINISHED,
    ]);
    expect(events[1]).toMatchObject({ snapshot: { fresh: 1 } });
    expect(events[2]).toMatchObject({ name: 'on_interrupt', value: interrupt });
    expect(events[3]).toMatchObject({ message: 'boom' });
  });

  it('cancels scripted emissions when unsubscribed', async () => {
    vi.useFakeTimers();
    const agent = new FakeAgent({
      delayMs: 100,
      script: [{
        when: 'initial',
        events: [
          { type: 'TOOL_CALL_START', toolCallId: 'tool-1', toolCallName: 'get_weather' } as BaseEvent,
          { type: 'TOOL_CALL_ARGS', toolCallId: 'tool-1', delta: '{"city":"SF"}' } as BaseEvent,
          { type: 'TOOL_CALL_END', toolCallId: 'tool-1' } as BaseEvent,
        ],
      }],
    });
    const seen: BaseEvent[] = [];

    const sub = agent.run(minimalInput).subscribe((e) => seen.push(e));
    vi.advanceTimersByTime(50);
    sub.unsubscribe();
    vi.advanceTimersByTime(1000);

    expect(seen).toHaveLength(1);
    expect(seen[0].type).toBe(EventType.RUN_STARTED);
    vi.useRealTimers();
  });
});
