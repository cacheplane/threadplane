import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { signal } from '@angular/core';
import { Subject } from 'rxjs';
import {
  AgentError,
  completeDelivery,
  staticDelivery,
  streamingDelivery,
  type AgentStatus,
  type Message,
  type ToolCall,
  type AgentEvent,
} from '@threadplane/chat';
import { finalizeDeliveryRun, reduceEvent, type ReducerStore, type CustomStreamEvent, type ActivityEntry } from './reducer';

interface TestDeliveryRun {
  generation: string;
  baselineMessageIds: Set<string>;
  ownedMessageIds: Set<string>;
  snapshotReplacementIds: Set<string>;
  currentAssistantMessageId?: string;
  eligibleBaselineAssistantId?: string;
  protocolRunId?: string;
  outcome?: 'success' | 'error' | 'aborted' | 'interrupted' | 'paused';
}

type TestStore = ReducerStore & {
  deliveryRun: TestDeliveryRun | null;
  allocateDeliveryGeneration: (scope: string) => string;
};

function makeStore(generation = 'run-generation-1'): TestStore {
  let activitySequence = 0;
  return {
    messages:  signal<Message[]>([]),
    status:    signal<AgentStatus>('idle'),
    isLoading: signal(false),
    error:     signal<AgentError | undefined>(undefined),
    toolCalls: signal<ToolCall[]>([]),
    state:     signal<Record<string, unknown>>({}),
    interrupt: signal(undefined),
    events$:   new Subject<AgentEvent>(),
    customEvents: signal<CustomStreamEvent[]>([]),
    activities: signal<Map<string, ActivityEntry>>(new Map()),
    deliveryRun: {
      generation,
      baselineMessageIds: new Set(),
      ownedMessageIds: new Set(),
      snapshotReplacementIds: new Set(),
    },
    allocateDeliveryGeneration: (scope: string) => `${generation}:${scope}:${++activitySequence}`,
  } as TestStore;
}

describe('reduceEvent', () => {
  it('RUN_STARTED establishes running state for the already-allocated generation', () => {
    const store = makeStore();
    const allocatedRun = store.deliveryRun;
    // Seed a previous AgentError so the clear can be observed.
    store.error.set(new AgentError({ kind: 'server', message: 'previous', retryable: true }));
    reduceEvent({ type: 'RUN_STARTED', runId: 'protocol-run-1' } as any, store);
    expect(store.status()).toBe('running');
    expect(store.isLoading()).toBe(true);
    expect(store.error()).toBeUndefined();
    expect(store.deliveryRun).toBe(allocatedRun);
    expect(store.deliveryRun?.generation).toBe('run-generation-1');
    expect(store.deliveryRun?.protocolRunId).toBe('protocol-run-1');
  });

  it('RUN_FINISHED finalizes only active-generation messages as successful', () => {
    const store = makeStore();
    store.status.set('running');
    store.isLoading.set(true);
    store.messages.set([
      { id: 'historical', role: 'assistant', content: 'old', delivery: staticDelivery('historical') },
      { id: 'active', role: 'assistant', content: 'new', delivery: streamingDelivery('run-generation-1') },
    ]);
    store.deliveryRun!.ownedMessageIds.add('active');
    reduceEvent({ type: 'RUN_FINISHED' } as any, store);
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);
    expect(store.messages()[0].delivery).toEqual(staticDelivery('historical'));
    expect(store.messages()[1].delivery).toEqual(completeDelivery('run-generation-1', 'success'));
  });

  it('RUN_ERROR finalizes active-generation messages as error', () => {
    const store = makeStore();
    store.messages.set([
      { id: 'active', role: 'assistant', content: 'partial', delivery: streamingDelivery('run-generation-1') },
    ]);
    store.deliveryRun!.ownedMessageIds.add('active');
    reduceEvent({ type: 'RUN_ERROR', message: 'boom' } as any, store);
    expect(store.status()).toBe('error');
    const err = store.error();
    expect(err).toBeInstanceOf(AgentError);
    expect(err?.message).toContain('boom');
    expect(store.messages()[0].delivery).toEqual(completeDelivery('run-generation-1', 'error'));
  });

  it('TEXT_MESSAGE_START appends an empty assistant message owned by the active generation', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    expect(store.messages()).toEqual([
      { id: 'm1', role: 'assistant', content: '', delivery: streamingDelivery('run-generation-1') },
    ]);
  });

  it('TEXT_MESSAGE_CONTENT appends delta to in-flight message', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hi ' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'there' } as any, store);
    expect(store.messages()[0].content).toBe('hi there');
    expect(store.messages()[0].delivery).toEqual(streamingDelivery('run-generation-1'));
  });

  it.each([
    ['TEXT_MESSAGE_START', { type: 'TEXT_MESSAGE_START', messageId: 'm2' }],
    ['REASONING_MESSAGE_START', { type: 'REASONING_MESSAGE_START', messageId: 'm2' }],
    ['TOOL_CALL_START', {
      type: 'TOOL_CALL_START', toolCallId: 't2', toolCallName: 'search', parentMessageId: 'm2',
    }],
  ])('%s starts a new assistant step and completes the previous one in the same generation', (_type, event) => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'first step' } as any, store);

    reduceEvent(event as any, store);

    expect(store.messages().find(message => message.id === 'm1')?.delivery)
      .toEqual(completeDelivery('run-generation-1', 'success'));
    expect(store.messages().find(message => message.id === 'm2')?.delivery)
      .toEqual(streamingDelivery('run-generation-1'));
    expect(store.deliveryRun?.currentAssistantMessageId).toBe('m2');
  });

  it('ignores stale content for a completed prior assistant step', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'first step' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm2' } as any, store);

    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' stale' } as any, store);

    expect(store.messages().find(message => message.id === 'm1')).toMatchObject({
      content: 'first step',
      delivery: completeDelivery('run-generation-1', 'success'),
    });
    expect(store.messages().find(message => message.id === 'm2')?.delivery)
      .toEqual(streamingDelivery('run-generation-1'));
    expect(store.deliveryRun?.currentAssistantMessageId).toBe('m2');
  });

  it('publishes an authoritative rewrite of a completed step as a new completed generation', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'first step' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm2' } as any, store);

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'm1', role: 'assistant', content: 'authoritative rewrite' },
        { id: 'm2', role: 'assistant', content: 'current snapshot' },
      ],
    } as any, store);

    const replacement = store.messages().find(message => message.id === 'm1');
    expect(replacement).toMatchObject({
      content: 'authoritative rewrite',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    const replacementGeneration = replacement?.delivery.generation;
    expect(replacementGeneration).not.toBe('run-generation-1');
    expect(store.messages().find(message => message.id === 'm2')).toMatchObject({
      content: 'current snapshot',
      delivery: streamingDelivery('run-generation-1'),
    });

    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: ' stale' } as any, store);
    expect(store.messages().find(message => message.id === 'm1')).toMatchObject({
      content: 'authoritative rewrite',
      delivery: { generation: replacementGeneration, phase: 'complete', outcome: 'success' },
    });

    const rewrittenSnapshot = {
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'm1', role: 'assistant', content: 'second authoritative rewrite' },
      ],
    } as any;
    reduceEvent(rewrittenSnapshot, store);

    const secondReplacement = store.messages().find(message => message.id === 'm1');
    expect(secondReplacement).toMatchObject({
      content: 'second authoritative rewrite',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(secondReplacement?.delivery.generation).not.toBe(replacementGeneration);
    expect(store.messages().find(message => message.id === 'm2')).toMatchObject({
      content: 'current snapshot',
      delivery: streamingDelivery('run-generation-1'),
    });

    reduceEvent(rewrittenSnapshot, store);
    expect(store.messages().find(message => message.id === 'm1')?.delivery.generation)
      .toBe(secondReplacement?.delivery.generation);
  });

  it('preserves an omitted current assistant so later deltas still apply', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'first step' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm2' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: 'second step' } as any, store);

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [{ id: 'm1', role: 'assistant', content: 'first step' }],
    } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm2', delta: ' continued' } as any, store);

    expect(store.messages().find(message => message.id === 'm2')).toMatchObject({
      content: 'second step continued',
      delivery: streamingDelivery('run-generation-1'),
    });
    expect(store.deliveryRun?.currentAssistantMessageId).toBe('m2');
  });

  it('TOOL_CALL_START creates a tool-call-only assistant slot owned by the active generation', () => {
    const store = makeStore();
    reduceEvent({
      type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search', parentMessageId: 'tool-parent',
    } as any, store);
    expect(store.messages()[0].delivery).toEqual(streamingDelivery('run-generation-1'));
  });

  it('MESSAGES_SNAPSHOT re-applies citations from prior STATE onto the final message', () => {
    // Reproduces the AG-UI citation-delivery ordering: STATE_SNAPSHOT carries
    // citations keyed by the final AI message id, but arrives BEFORE the
    // MESSAGES_SNAPSHOT that swaps the streamed chunk-id message for the final
    // one. Without re-bridging in the MESSAGES_SNAPSHOT handler the citations
    // are dropped on the swap.
    const store = makeStore();
    reduceEvent({
      type: 'STATE_SNAPSHOT',
      snapshot: {
        citations: {
          'resp-final': [
            { id: 'ng-signals-overview', index: 1, title: 'Signals — Angular guide', url: 'https://angular.dev/guide/signals' },
          ],
        },
      },
    } as any, store);
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [{ id: 'resp-final', role: 'assistant', content: 'Signals are reactive [^ng-signals-overview].' }],
    } as any, store);

    const msg = store.messages().find((m) => m.id === 'resp-final');
    expect(msg?.citations?.length).toBe(1);
    expect(msg?.citations?.[0]).toMatchObject({ id: 'ng-signals-overview', title: 'Signals — Angular guide' });
  });

  it('restored MESSAGES_SNAPSHOT messages are static complete/success', () => {
    const store = makeStore();
    store.deliveryRun = null;
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: 'restored' },
      ],
    } as any, store);
    expect(store.messages().map(message => message.delivery)).toEqual([
      staticDelivery('u1'),
      staticDelivery('a1'),
    ]);
  });

  it('in-run canonical snapshot preserves the current attempt generation without retagging history', () => {
    const store = makeStore();
    store.messages.set([
      { id: 'u-old', role: 'user', content: 'old', delivery: staticDelivery('u-old') },
      { id: 'a-old', role: 'assistant', content: 'history', delivery: completeDelivery('prior-run', 'success') },
      { id: 'u-current', role: 'user', content: 'new', delivery: staticDelivery('u-current') },
      { id: 'chunk-id', role: 'assistant', content: 'streamed', delivery: streamingDelivery('run-generation-1') },
    ]);
    store.deliveryRun!.baselineMessageIds = new Set(['u-old', 'a-old', 'u-current']);
    store.deliveryRun!.ownedMessageIds.add('chunk-id');
    store.deliveryRun!.currentAssistantMessageId = 'chunk-id';

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'u-old', role: 'user', content: 'old' },
        { id: 'a-old', role: 'assistant', content: 'history enriched' },
        { id: 'u-current', role: 'user', content: 'new' },
        { id: 'canonical-id', role: 'assistant', content: 'canonical' },
      ],
    } as any, store);

    expect(store.messages().find(message => message.id === 'a-old')?.delivery)
      .toEqual(completeDelivery('prior-run', 'success'));
    expect(store.messages().find(message => message.id === 'canonical-id')?.delivery)
      .toEqual(streamingDelivery('run-generation-1'));
    expect(store.deliveryRun?.ownedMessageIds.has('canonical-id')).toBe(true);
    expect(store.deliveryRun?.currentAssistantMessageId).toBe('canonical-id');
  });

  it('owns a snapshot-only active assistant and finalizes it on RUN_FINISHED', () => {
    const store = makeStore();
    store.messages.set([
      { id: 'u1', role: 'user', content: 'hello', delivery: staticDelivery('u1') },
    ]);
    store.deliveryRun!.baselineMessageIds = new Set(['u1']);
    reduceEvent({ type: 'RUN_STARTED', runId: 'run-1' } as any, store);

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'snapshot-ai', role: 'assistant', content: 'snapshot only' },
      ],
    } as any, store);

    expect(store.messages().find(message => message.id === 'snapshot-ai')?.delivery)
      .toEqual(streamingDelivery('run-generation-1'));
    reduceEvent({ type: 'RUN_FINISHED', runId: 'run-1' } as any, store);
    expect(store.messages().find(message => message.id === 'snapshot-ai')?.delivery)
      .toEqual(completeDelivery('run-generation-1', 'success'));
  });

  it('retags only an explicitly eligible reused baseline tail', () => {
    const store = makeStore();
    store.messages.set([
      { id: 'historical-ai', role: 'assistant', content: 'history', delivery: staticDelivery('historical-ai') },
      { id: 'u1', role: 'user', content: 'hello', delivery: staticDelivery('u1') },
      { id: 'tail-ai', role: 'assistant', content: 'prior', delivery: completeDelivery('prior-run', 'success') },
    ]);
    store.deliveryRun!.baselineMessageIds = new Set(['historical-ai', 'u1', 'tail-ai']);
    store.deliveryRun!.eligibleBaselineAssistantId = 'tail-ai';

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'historical-ai', role: 'assistant', content: 'history enriched' },
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'tail-ai', role: 'assistant', content: 'replacement' },
      ],
    } as any, store);

    expect(store.messages().find(message => message.id === 'historical-ai')?.delivery)
      .toEqual(staticDelivery('historical-ai'));
    expect(store.messages().find(message => message.id === 'tail-ai')?.delivery)
      .toEqual(streamingDelivery('run-generation-1'));
  });

  it('does not retag baseline assistant history without continuation permission', () => {
    const store = makeStore();
    store.messages.set([
      { id: 'tail-ai', role: 'assistant', content: 'prior', delivery: completeDelivery('prior-run', 'success') },
    ]);
    store.deliveryRun!.baselineMessageIds = new Set(['tail-ai']);

    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [{ id: 'tail-ai', role: 'assistant', content: 'same history' }],
    } as any, store);

    expect(store.messages()[0].delivery).toEqual(completeDelivery('prior-run', 'success'));
  });

  it('TOOL_CALL_START appends a running tool call', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    expect(store.toolCalls()).toEqual([{ id: 't1', name: 'search', args: {}, status: 'running' }]);
  });

  it('TOOL_CALL_START links the tool call to its parent assistant message (creating the slot)', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'weather_card', parentMessageId: 'a1' } as any, store);
    expect(store.toolCalls()).toEqual([{ id: 't1', name: 'weather_card', args: {}, status: 'running' }]);
    const msg = store.messages().find((m) => m.id === 'a1');
    expect(msg).toBeDefined();
    expect(msg!.role).toBe('assistant');
    expect(msg!.toolCallIds).toEqual(['t1']);
  });

  it('TOOL_CALL_START appends toolCallIds to an existing parent assistant message', () => {
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'a1' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'weather_card', parentMessageId: 'a1' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't2', toolCallName: 'weather_card', parentMessageId: 'a1' } as any, store);
    const a1 = store.messages().filter((m) => m.id === 'a1');
    expect(a1).toHaveLength(1);
    expect(a1[0].toolCallIds).toEqual(['t1', 't2']);
  });

  it('TOOL_CALL_START without parentMessageId does not create or modify messages', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    expect(store.messages()).toEqual([]);
    expect(store.toolCalls()).toEqual([{ id: 't1', name: 'search', args: {}, status: 'running' }]);
  });

  it('TOOL_CALL_ARGS replaces args on the matching tool call', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"q":"hi"}' } as any, store);
    expect(store.toolCalls()[0].args).toEqual({ q: 'hi' });
  });

  it('TOOL_CALL_ARGS accumulates streamed fragments into the full args', () => {
    // Regression: a live model streams args as many partial-JSON deltas
    // (`{"loca`, `tion":"Pa`, …). Parsing each delta in isolation never
    // succeeds, so args silently stayed {} and tool views rendered empty
    // (stuck on their loading state). The reducer must accumulate the raw
    // text and parse the accumulated buffer.
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'weather_card' } as any, store);
    for (const delta of ['{"loca', 'tion":"Par', 'is","temperatureF":7', '2}']) {
      reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta } as any, store);
    }
    reduceEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' } as any, store);
    expect(store.toolCalls()[0].args).toEqual({ location: 'Paris', temperatureF: 72 });
    expect(store.toolCalls()[0].status).toBe('complete');
  });

  it('TOOL_CALL_ARGS keeps last-good args while the buffer is mid-fragment', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"q":"hi"}' } as any, store);
    expect(store.toolCalls()[0].args).toEqual({ q: 'hi' });
  });

  it('TOOL_CALL_ARGS buffers independently per tool call', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'a' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't2', toolCallName: 'b' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '{"x":' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't2', delta: '{"y":' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't1', delta: '1}' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_ARGS', toolCallId: 't2', delta: '2}' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_END', toolCallId: 't2' } as any, store);
    expect(store.toolCalls().find((t) => t.id === 't1')!.args).toEqual({ x: 1 });
    expect(store.toolCalls().find((t) => t.id === 't2')!.args).toEqual({ y: 2 });
  });

  it('TOOL_CALL_END marks the matching tool call complete', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_END', toolCallId: 't1' } as any, store);
    expect(store.toolCalls()[0].status).toBe('complete');
  });

  it('TOOL_CALL_RESULT sets the result on the matching call', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: 'found' } as any, store);
    expect(store.toolCalls()[0].result).toBe('found');
  });

  it('TOOL_CALL_RESULT parses JSON string content into an object', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'weather_card' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: '{"temperatureF":68,"location":"San Francisco"}' } as any, store);
    expect(store.toolCalls()[0].result).toEqual({ temperatureF: 68, location: 'San Francisco' });
  });

  it('TOOL_CALL_RESULT preserves non-JSON string result as-is', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 't1', toolCallName: 'search' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 't1', content: 'plain text result' } as any, store);
    expect(store.toolCalls()[0].result).toBe('plain text result');
  });

  it('STATE_SNAPSHOT replaces state wholesale', () => {
    const store = makeStore();
    store.state.set({ prior: true });
    reduceEvent({ type: 'STATE_SNAPSHOT', snapshot: { fresh: 1 } } as any, store);
    expect(store.state()).toEqual({ fresh: 1 });
  });

  it('STATE_DELTA applies JSON Patch operations', () => {
    const store = makeStore();
    store.state.set({ a: 1 });
    reduceEvent({
      type: 'STATE_DELTA',
      delta: [{ op: 'replace', path: '/a', value: 2 }, { op: 'add', path: '/b', value: 3 }],
    } as any, store);
    expect(store.state()).toEqual({ a: 2, b: 3 });
  });

  it('MESSAGES_SNAPSHOT replaces messages wholesale', () => {
    const store = makeStore();
    store.deliveryRun = null;
    store.messages.set([{ id: 'old', role: 'user', content: 'old' }]);
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [{ id: 'new', role: 'assistant', content: 'fresh' }],
    } as any, store);
    expect(store.messages()).toEqual([
      { id: 'new', role: 'assistant', content: 'fresh', delivery: staticDelivery('new') },
    ]);
  });

  it('MESSAGES_SNAPSHOT bridges assistant toolCalls to toolCallIds', () => {
    const store = makeStore();
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'u1', role: 'user', content: 'hello' },
        { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'weather_card', arguments: '{"location":"SF"}' } }] },
        { id: 'a2', role: 'assistant', content: 'Here is the weather.' },
      ],
    } as any, store);
    const a1 = store.messages().find((m) => m.id === 'a1');
    expect(a1).toBeDefined();
    expect(a1!.toolCallIds).toEqual(['tc1']);
    expect((a1 as any).toolCalls).toBeUndefined();
    const a2 = store.messages().find((m) => m.id === 'a2');
    expect(a2!.toolCallIds).toBeUndefined();
  });

  it('MESSAGES_SNAPSHOT inserts snapshot-only tool calls into store.toolCalls', () => {
    const store = makeStore();
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [
        { id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'weather_card', arguments: '{"location":"SF"}' } }] },
      ],
    } as any, store);
    const tc = store.toolCalls().find((t) => t.id === 'tc1');
    expect(tc).toBeDefined();
    expect(tc!.name).toBe('weather_card');
    expect(tc!.args).toEqual({ location: 'SF' });
    expect(tc!.status).toBe('complete');
  });

  it('MESSAGES_SNAPSHOT does not duplicate a tool call already in store.toolCalls', () => {
    const store = makeStore();
    reduceEvent({ type: 'TOOL_CALL_START', toolCallId: 'tc1', toolCallName: 'weather_card', parentMessageId: 'a1' } as any, store);
    reduceEvent({ type: 'TOOL_CALL_RESULT', toolCallId: 'tc1', content: '{"temperatureF":68}' } as any, store);
    reduceEvent({
      type: 'MESSAGES_SNAPSHOT',
      messages: [{ id: 'a1', role: 'assistant', content: '', toolCalls: [{ id: 'tc1', type: 'function', function: { name: 'weather_card', arguments: '{}' } }] }],
    } as any, store);
    expect(store.toolCalls().filter((t) => t.id === 'tc1')).toHaveLength(1);
    // The original entry (with result) is kept, not replaced by the snapshot entry.
    expect(store.toolCalls().find((t) => t.id === 'tc1')!.result).toEqual({ temperatureF: 68 });
  });

  it('CUSTOM with name=state_update emits AgentStateUpdateEvent', async () => {
    const store = makeStore();
    const events: AgentEvent[] = [];
    store.events$.subscribe((e) => events.push(e));
    reduceEvent({ type: 'CUSTOM', name: 'state_update', value: { count: 1 } } as any, store);
    expect(events).toEqual([{ type: 'state_update', data: { count: 1 } }]);
  });

  it('CUSTOM with other name emits AgentCustomEvent', async () => {
    const store = makeStore();
    const events: AgentEvent[] = [];
    store.events$.subscribe((e) => events.push(e));
    reduceEvent({ type: 'CUSTOM', name: 'tick', value: 42 } as any, store);
    expect(events).toEqual([{ type: 'custom', name: 'tick', data: 42 }]);
  });

  it('unknown event types are no-ops', () => {
    const store = makeStore();
    reduceEvent({ type: 'FUTURE_EVENT' } as any, store);
    expect(store.messages()).toEqual([]);
    expect(store.status()).toBe('idle');
  });
});

describe('reduceEvent — interrupt', () => {
  it('sets interrupt from a CUSTOM on_interrupt event', () => {
    const store = makeStore();
    reduceEvent({ type: 'CUSTOM', name: 'on_interrupt', value: { kind: 'refund_approval', amount: 42 } } as never, store);
    const ix = store.interrupt();
    expect(ix).toBeTruthy();
    expect(ix!.value).toEqual({ kind: 'refund_approval', amount: 42 });
    expect(ix!.resumable).toBe(true);
    expect(typeof ix!.id).toBe('string');
  });
  it('terminalizes the active generation as paused and ignores a later RUN_FINISHED', () => {
    const store = makeStore();
    store.status.set('running');
    store.isLoading.set(true);
    reduceEvent({ type: 'RUN_STARTED', runId: 'run-1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1', runId: 'run-1' } as any, store);

    reduceEvent({
      type: 'CUSTOM', name: 'on_interrupt', value: { kind: 'approval' }, runId: 'run-1',
    } as any, store);

    expect(store.messages()[0].delivery).toEqual(completeDelivery('run-generation-1', 'paused'));
    expect(store.deliveryRun?.outcome).toBe('paused');
    expect(store.status()).toBe('idle');
    expect(store.isLoading()).toBe(false);

    reduceEvent({ type: 'RUN_FINISHED', runId: 'run-1' } as any, store);

    expect(store.messages()[0].delivery).toEqual(completeDelivery('run-generation-1', 'paused'));
    expect(store.deliveryRun?.outcome).toBe('paused');
  });
  it('clears interrupt on RUN_STARTED', () => {
    const store = makeStore();
    store.interrupt.set({ id: 'x', value: {}, resumable: true });
    reduceEvent({ type: 'RUN_STARTED' } as never, store);
    expect(store.interrupt()).toBeUndefined();
  });
  it('still forwards non-interrupt CUSTOM events to events$', () => {
    const store = makeStore();
    const seen: unknown[] = [];
    store.events$.subscribe((e) => seen.push(e));
    reduceEvent({ type: 'CUSTOM', name: 'state_update', value: { a: 1 } } as never, store);
    expect(seen).toEqual([{ type: 'state_update', data: { a: 1 } }]);
    expect(store.interrupt()).toBeUndefined();
  });
});

describe('reduceEvent — REASONING_MESSAGE_*', () => {
  let now = 100;
  beforeEach(() => {
    now = 100;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
  });
  afterEach(() => vi.restoreAllMocks());

  function reasoning(store: ReducerStore, type: string, messageId = 'owned', runId?: string) {
    reduceEvent({ type: `REASONING_MESSAGE_${type}`, messageId, runId, delta: 'thinking' } as any, store);
  }

  it('consumes a start once and leaves duplicate END references unchanged', () => {
    const store = makeStore();
    reasoning(store, 'START');
    now = 200;
    reasoning(store, 'END');
    const messages = store.messages();
    expect(messages[0].reasoningDurationMs).toBe(100);
    now = 400;
    reasoning(store, 'END');
    expect(store.messages()).toBe(messages);
    expect(store.messages()[0]).toBe(messages[0]);
  });

  it('does not inherit a same-id start from a previous run', () => {
    const store = makeStore();
    reasoning(store, 'START');
    finalizeDeliveryRun(store, store.deliveryRun!, 'success');
    store.deliveryRun = makeStore('next-generation').deliveryRun;
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'owned' } as any, store);
    const messages = store.messages();
    now = 400;
    reasoning(store, 'END');
    expect(store.messages()).toBe(messages);
    expect(messages[0].reasoningDurationMs).toBeUndefined();
    reasoning(store, 'START');
    now = 450;
    reasoning(store, 'END');
    expect(store.messages()[0].reasoningDurationMs).toBe(50);
  });

  it('restarts the clock and clears stale duration while retaining reasoning text', () => {
    const store = makeStore();
    reasoning(store, 'START');
    reasoning(store, 'CONTENT');
    now = 200;
    reasoning(store, 'END');
    now = 300;
    reasoning(store, 'START');
    expect(store.messages()[0].reasoningDurationMs).toBeUndefined();
    expect(store.messages()[0].reasoning).toBe('thinking');
    now = 350;
    reasoning(store, 'START');
    now = 400;
    reasoning(store, 'END');
    expect(store.messages()[0].reasoningDurationMs).toBe(50);
  });

  it.each(['success', 'error', 'paused', 'aborted', 'interrupted'] as const)(
    'clears pending timing on %s and ignores late reasoning events', outcome => {
      const store = makeStore();
      reasoning(store, 'START');
      const run = store.deliveryRun!;
      finalizeDeliveryRun(store, run, outcome);
      const messages = store.messages();
      now = 500;
      for (const type of ['END', 'START', 'CONTENT', 'CHUNK']) reasoning(store, type);
      expect(store.messages()).toBe(messages);
      expect(run).not.toHaveProperty('pendingReasoning');
      expect(finalizeDeliveryRun(store, run, outcome)).toBe(false);
    },
  );

  it.each(['TEXT_MESSAGE_START', 'TOOL_CALL_START', 'MESSAGES_SNAPSHOT'])(
    'discards the previous clock when %s moves assistant ownership', type => {
      const store = makeStore();
      reasoning(store, 'START');
      reduceEvent({ type, messageId: 'next', parentMessageId: 'next', toolCallId: 'tool',
        toolCallName: 'tool', messages: [{ id: 'next', role: 'assistant', content: 'canonical' }] } as any, store);
      const messages = store.messages();
      now = 500;
      reasoning(store, 'END');
      expect(store.messages()).toBe(messages);
      expect(store.deliveryRun).not.toHaveProperty('pendingReasoning');
      expect(store.deliveryRun?.currentAssistantMessageId).toBe('next');
    },
  );

  it.each(['START', 'CONTENT', 'CHUNK', 'END'])(
    'ignores foreign-run reasoning %s without disturbing the valid clock', type => {
      const store = makeStore();
      reduceEvent({ type: 'RUN_STARTED', runId: 'current' } as any, store);
      reasoning(store, 'START', 'owned', 'current');
      const messages = store.messages();
      now = 200;
      reasoning(store, type, 'owned', 'foreign');
      expect(store.messages()).toBe(messages);
      now = 300;
      reasoning(store, 'END', 'owned', 'current');
      expect(store.messages()[0].reasoningDurationMs).toBe(200);
    },
  );

  it.each(['static', 'wrong-generation', 'completed', 'non-assistant', 'unowned', 'not-current', 'no-run'])(
    'does not let END mutate a %s message or claim ownership', scenario => {
      const store = makeStore();
      reasoning(store, 'START');
      const message = store.messages()[0];
      if (scenario === 'static') store.messages.set([{ ...message, delivery: staticDelivery('owned') }]);
      if (scenario === 'wrong-generation') store.messages.set([{ ...message, delivery: streamingDelivery('other') }]);
      if (scenario === 'completed') store.messages.set([{ ...message, delivery: completeDelivery('run-generation-1', 'success') }]);
      if (scenario === 'non-assistant') store.messages.set([{ ...message, role: 'user' }]);
      if (scenario === 'unowned') store.deliveryRun!.ownedMessageIds.clear();
      if (scenario === 'not-current') store.deliveryRun!.currentAssistantMessageId = 'different';
      if (scenario === 'no-run') store.deliveryRun = null;
      const messages = store.messages();
      now = 200;
      reasoning(store, 'END');
      expect(store.messages()).toBe(messages);
    },
  );

  it('leaves an END without a local start inert even when another store has that ID', () => {
    const other = makeStore();
    reasoning(other, 'START');
    const store = makeStore();
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'owned' } as any, store);
    const messages = store.messages();
    reasoning(store, 'END');
    expect(store.messages()).toBe(messages);
    expect(store.deliveryRun?.currentAssistantMessageId).toBe('owned');
  });

  it('keeps pending timing across a same-id canonical snapshot and keeps its replacement policy', () => {
    const store = makeStore();
    reasoning(store, 'START');
    const snapshot = { type: 'MESSAGES_SNAPSHOT', messages: [{ id: 'owned', role: 'assistant', content: 'canonical' }] } as any;
    reduceEvent(snapshot, store);
    now = 200;
    reasoning(store, 'END');
    expect(store.messages()[0].reasoningDurationMs).toBe(100);
    expect(store.messages()[0].content).toBe('canonical');
    reduceEvent(snapshot, store);
    expect(store.messages()[0].reasoningDurationMs).toBeUndefined();
    const messages = store.messages();
    reasoning(store, 'END');
    expect(store.messages()).toBe(messages);
  });

  it('keeps same-id reasoning clocks isolated between simultaneous stores', () => {
    const first = makeStore('first');
    const second = makeStore('second');
    const clock = vi.spyOn(Date, 'now');
    try {
      clock.mockReturnValue(100);
      reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'shared' } as any, first);
      clock.mockReturnValue(200);
      reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'shared' } as any, second);
      clock.mockReturnValue(300);
      reduceEvent({ type: 'REASONING_MESSAGE_END', messageId: 'shared' } as any, first);
      expect(first.messages()[0].reasoningDurationMs).toBe(200);
      clock.mockReturnValue(450);
      reduceEvent({ type: 'REASONING_MESSAGE_END', messageId: 'shared' } as any, second);
      expect(second.messages()[0].reasoningDurationMs).toBe(250);
    } finally {
      clock.mockRestore();
    }
  });

  it('REASONING_MESSAGE_START creates an assistant slot with empty reasoning', () => {
    const store = makeStore();
    reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    const msgs = store.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].id).toBe('m1');
    expect(msgs[0].role).toBe('assistant');
    expect(msgs[0].reasoning).toBe('');
    expect(msgs[0].delivery).toEqual(streamingDelivery('run-generation-1'));
  });

  it('REASONING_MESSAGE_CONTENT appends to the existing reasoning string', () => {
    const store = makeStore();
    reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'm1', delta: 'first ' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'm1', delta: 'then second' } as any, store);
    expect(store.messages()[0].reasoning).toBe('first then second');
    expect(store.messages()[0].delivery).toEqual(streamingDelivery('run-generation-1'));
  });

  it('REASONING_MESSAGE_CHUNK is treated identically to CONTENT', () => {
    const store = makeStore();
    reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CHUNK', messageId: 'm1', delta: 'chunk1' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CHUNK', messageId: 'm1', delta: 'chunk2' } as any, store);
    expect(store.messages()[0].reasoning).toBe('chunk1chunk2');
  });

  it('REASONING_MESSAGE_END writes a non-negative reasoningDurationMs', () => {
    const store = makeStore();
    reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'm1', delta: 'reasoned.' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_END', messageId: 'm1' } as any, store);
    const m = store.messages()[0];
    expect(typeof m.reasoningDurationMs).toBe('number');
    expect(m.reasoningDurationMs).toBeGreaterThanOrEqual(0);
  });

  it('TEXT_MESSAGE_START after REASONING_MESSAGE_START reuses the same id', () => {
    const store = makeStore();
    reduceEvent({ type: 'REASONING_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_CONTENT', messageId: 'm1', delta: 'thinking' } as any, store);
    reduceEvent({ type: 'REASONING_MESSAGE_END', messageId: 'm1' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_START', messageId: 'm1', role: 'assistant' } as any, store);
    reduceEvent({ type: 'TEXT_MESSAGE_CONTENT', messageId: 'm1', delta: 'hello' } as any, store);
    const msgs = store.messages();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].reasoning).toBe('thinking');
    expect(msgs[0].content).toBe('hello');
  });
});

describe('reduceEvent — customEvents accumulation', () => {
  it('accumulates non-interrupt CUSTOM events as {name, data} in order', () => {
    const store = makeStore();
    reduceEvent({ type: 'CUSTOM', name: 'a2ui-partial', value: { tool_call_id: 't1', args_so_far: '{' } } as any, store);
    reduceEvent({ type: 'CUSTOM', name: 'a2ui-partial', value: { tool_call_id: 't1', args_so_far: '{"a":1' } } as any, store);
    expect(store.customEvents()).toEqual([
      { name: 'a2ui-partial', data: { tool_call_id: 't1', args_so_far: '{' } },
      { name: 'a2ui-partial', data: { tool_call_id: 't1', args_so_far: '{"a":1' } },
    ]);
  });

  it('parses JSON-string CUSTOM values before storing', () => {
    const store = makeStore();
    reduceEvent({ type: 'CUSTOM', name: 'a2ui-partial', value: '{"tool_call_id":"t1","args_so_far":"{"}' } as any, store);
    expect(store.customEvents()).toEqual([
      { name: 'a2ui-partial', data: { tool_call_id: 't1', args_so_far: '{' } },
    ]);
  });

  it('does NOT accumulate on_interrupt CUSTOM events (those drive the interrupt signal)', () => {
    const store = makeStore();
    reduceEvent({ type: 'CUSTOM', name: 'on_interrupt', value: { foo: 'bar' } } as any, store);
    expect(store.customEvents()).toEqual([]);
    expect(store.interrupt()).toMatchObject({ value: { foo: 'bar' } });
  });

  it('RUN_STARTED resets customEvents for the new run', () => {
    const store = makeStore();
    reduceEvent({ type: 'CUSTOM', name: 'a2ui-partial', value: { tool_call_id: 't1', args_so_far: '{' } } as any, store);
    expect(store.customEvents()).toHaveLength(1);
    reduceEvent({ type: 'RUN_STARTED' } as any, store);
    expect(store.customEvents()).toEqual([]);
  });
});

describe('ACTIVITY events (F5 subagent activities)', () => {
  it('ACTIVITY_SNAPSHOT creates an activity entry keyed by messageId', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'tc-1', activityType: 'subagent',
      content: { toolCallId: 'tc-1', name: 'research', status: 'running', text: '' }, replace: true } as any, store);
    const entry = store.activities().get('tc-1');
    expect(entry?.activityType).toBe('subagent');
    expect(entry?.content()).toEqual({ toolCallId: 'tc-1', name: 'research', status: 'running', text: '' });
  });

  it('ACTIVITY_DELTA applies a JSON-patch to the entry content (live)', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'tc-1', activityType: 'subagent',
      content: { status: 'running', text: '' } } as any, store);
    reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'tc-1', activityType: 'subagent',
      patch: [{ op: 'replace', path: '/text', value: 'Paris is' }] } as any, store);
    expect(store.activities().get('tc-1')?.content()['text']).toBe('Paris is');
    reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'tc-1', activityType: 'subagent',
      patch: [{ op: 'replace', path: '/status', value: 'complete' }] } as any, store);
    expect(store.activities().get('tc-1')?.content()['status']).toBe('complete');
  });

  it('ACTIVITY_DELTA for an unknown messageId is ignored', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'nope', activityType: 'subagent',
      patch: [{ op: 'replace', path: '/text', value: 'x' }] } as any, store);
    expect(store.activities().size).toBe(0);
  });

  it('two concurrent subagents are keyed independently', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'a', activityType: 'subagent', content: { text: '' } } as any, store);
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'b', activityType: 'subagent', content: { text: '' } } as any, store);
    reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'a', activityType: 'subagent',
      patch: [{ op: 'replace', path: '/text', value: 'AAA' }] } as any, store);
    expect(store.activities().get('a')?.content()['text']).toBe('AAA');
    expect(store.activities().get('b')?.content()['text']).toBe('');
  });

  it('RUN_STARTED resets activities', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'a', activityType: 'subagent', content: {} } as any, store);
    reduceEvent({ type: 'RUN_STARTED' } as any, store);
    expect(store.activities().size).toBe(0);
  });

  it('ACTIVITY_SNAPSHOT without replace merges into existing content', () => {
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'tc-1', activityType: 'subagent',
      content: { status: 'running', text: 'hello' } } as never, store);
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'tc-1', activityType: 'subagent',
      content: { status: 'complete' } } as never, store);
    // merge: status updated, text preserved
    expect(store.activities().get('tc-1')?.content()).toEqual({ status: 'complete', text: 'hello' });
  });

  it('ACTIVITY_DELTA with a malformed patch (non-existent path) does not throw and leaves content unchanged', () => {
    // Regression guard: an out-of-order ACTIVITY_DELTA (e.g. replace /messages/5/content
    // when there are 0 messages) must be dropped — not thrown — so the stream stays usable.
    const store = makeStore();
    reduceEvent({ type: 'ACTIVITY_SNAPSHOT', messageId: 'tc-1', activityType: 'subagent',
      content: { status: 'running', text: 'prior' } } as any, store);
    // Send a patch that targets a non-existent array index — applyPatch throws without the guard.
    expect(() =>
      reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'tc-1', activityType: 'subagent',
        patch: [{ op: 'replace', path: '/messages/5/content', value: 'x' }] } as any, store),
    ).not.toThrow();
    // Prior content must be preserved unchanged.
    const content = store.activities().get('tc-1')?.content();
    expect(content?.['text']).toBe('prior');
    expect(content?.['status']).toBe('running');
    // Subsequent valid patches must still apply (store remains usable).
    reduceEvent({ type: 'ACTIVITY_DELTA', messageId: 'tc-1', activityType: 'subagent',
      patch: [{ op: 'replace', path: '/text', value: 'updated' }] } as any, store);
    expect(store.activities().get('tc-1')?.content()['text']).toBe('updated');
  });
});
