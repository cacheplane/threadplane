import { describe, it, expect, vi } from 'vitest';
import { BehaviorSubject, Subject } from 'rxjs';
import { createStreamManagerBridge } from './stream-manager.bridge';
import { MockAgentTransport } from '../transport/mock-stream.transport';
import { FetchStreamTransport } from '../transport/fetch-stream.transport';
import { ResourceStatus, AgentTransport, StreamSubjects, CustomStreamEvent, StreamEvent } from '../agent.types';
import type { AgentRuntimeTelemetryPayload } from '@threadplane/chat';
import { AgentError, AGENT_RECOVERY_MESSAGES, AGENT_RECOVERY_DETAILS } from '@threadplane/chat';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { of } from 'rxjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const developmentEvidence = vi.hoisted(() => ({ events: [] as string[], touches: 0, disposed: 0 }));
vi.mock('@threadplane/telemetry/browser', async (importOriginal) => ({
  ...await importOriginal<object>(),
  createDevelopmentRuntime: (options: { enabled?: () => boolean }) => ({
    touch: () => { if (options.enabled?.() !== false) developmentEvidence.touches++; },
    milestone: (kind: string) => { if (options.enabled?.() !== false) developmentEvidence.events.push(kind); },
    dispose: () => { developmentEvidence.disposed++; },
  }),
}));

describe('automatic development evidence', () => {
  function setup(telemetry?: false | ReturnType<typeof vi.fn>) {
    developmentEvidence.events = []; developmentEvidence.touches = 0; developmentEvidence.disposed = 0;
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({ options: { apiUrl: '', assistantId: 'test', transport, telemetry }, subjects, threadId$: of(null), destroy$ });
    return { transport, subjects, destroy$, bridge };
  }

  it('requires root terminal evidence and disposes with the bridge', async () => {
    const { transport, bridge, destroy$ } = setup();
    expect(developmentEvidence.touches).toBe(0);
    const run = bridge.submit({});
    transport.emit([{ type: 'values', data: { done: true } }]); transport.close();
    await run;
    expect(developmentEvidence.touches).toBeGreaterThan(0);
    expect(developmentEvidence.events).toContain('transport.connected');
    expect(developmentEvidence.events).toContain('runtime.first_stream_completed');
    destroy$.next();
    expect(developmentEvidence.disposed).toBe(1);
  });

  it.each([
    [],
    [{ type: 'unknown' }],
    [{ type: 'values', data: {}, namespace: ['child:1'] }],
    [{ type: 'values', data: {} }, { type: 'error', error: new Error('failed') }],
    [{ type: 'values', data: { __interrupt__: [{ value: {} }] } }],
    [{ type: 'messages/partial', data: [{ id: 'ai', type: 'ai', content: 'unfinished' }] }],
  ])('does not complete on an unqualified close %j', async (...events) => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.emit(events as StreamEvent[]); transport.close(); await run;
    expect(developmentEvidence.events).not.toContain('runtime.first_stream_completed');
    destroy$.next();
  });

  it.each([false, vi.fn()] as const)('respects explicit sinks %s', async telemetry => {
    const { transport, bridge, destroy$ } = setup(telemetry);
    const run = bridge.submit({}); transport.emit([{ type: 'values', data: { done: true } }]); transport.close(); await run;
    expect(developmentEvidence.events).toEqual([]); expect(developmentEvidence.touches).toBe(0);
    if (telemetry) expect(telemetry).toHaveBeenCalled();
    destroy$.next();
  });

  it.each([
    { type: 'messages/complete', data: { unexpected: true } },
    { type: 'messages/complete', data: [123] },
    { type: 'messages/complete' },
    { type: 'values', data: null },
    { type: 'values', data: null, namespace: [] },
    { type: 'values', data: 'invalid' },
    { type: 'values' },
    { type: 'checkpoints', data: null },
  ])('does not treat malformed known terminal payloads as development evidence: %j', async event => {
    const { transport, bridge, destroy$ } = setup();
    const run = bridge.submit({});
    transport.emit([event as StreamEvent]); transport.close();
    await run;
    expect(developmentEvidence.events).not.toContain('transport.connected');
    expect(developmentEvidence.events).not.toContain('runtime.first_stream_completed');
    destroy$.next();
  });

  it('records restored nonempty remote state, excluding empty history and run refresh', async () => {
    const { transport, bridge, destroy$ } = setup();
    bridge.switchThread('empty'); await Promise.resolve(); await Promise.resolve();
    expect(developmentEvidence.events).not.toContain('thread.persisted');
    transport.history = [makeThreadState('checkpoint')];
    bridge.switchThread('restored'); await Promise.resolve(); await Promise.resolve();
    expect(developmentEvidence.events).toContain('thread.persisted');
    developmentEvidence.events = [];
    const run = bridge.submit({}); transport.emit([{ type: 'values', data: { done: true } }]); transport.close(); await run;
    expect(developmentEvidence.events).not.toContain('thread.persisted');
    destroy$.next();
  });

  it('counts only real pending interrupt resumes that finish successfully', async () => {
    const { transport, bridge, destroy$ } = setup();
    let invocation = 0;
    transport.stream = async function* () {
      yield ++invocation === 1
        ? { type: 'values', data: { __interrupt__: [{ value: {} }] } }
        : { type: 'values', data: { done: true } };
    };
    await bridge.submit({});
    expect(developmentEvidence.events).not.toContain('runtime.first_stream_completed');
    await bridge.submit(null, { command: { resume: true } });
    expect(developmentEvidence.events).toContain('interrupt.handled');
    developmentEvidence.events = [];
    await bridge.submit(null, { command: { resume: true } });
    expect(developmentEvidence.events).not.toContain('interrupt.handled');
    destroy$.next();
  });

  it.each(['stop', 'dispose', 'thread switch', 'external abort'])('excludes completion after %s', async action => {
    const { transport, bridge, destroy$ } = setup();
    const external = new AbortController();
    const run = bridge.submit({}, action === 'external abort' ? { signal: external.signal } : undefined);
    transport.emit([{ type: 'values', data: { done: true } }]);
    await vi.waitFor(() => expect(developmentEvidence.events).toContain('transport.connected'));
    if (action === 'stop') await bridge.stop();
    else if (action === 'dispose') destroy$.next();
    else if (action === 'thread switch') bridge.switchThread(null);
    else external.abort();
    transport.close(); await run;
    expect(developmentEvidence.events).not.toContain('runtime.first_stream_completed');
    expect(developmentEvidence.events).not.toContain('interrupt.handled');
    if (action !== 'dispose') destroy$.next();
  });

  it('records successful joined runs through the same evidence rules', async () => {
    const { bridge, destroy$ } = setup();
    bridge.switchThread('joined');
    await bridge.joinStream('run-1');
    expect(developmentEvidence.events).toContain('transport.connected');
    expect(developmentEvidence.events).toContain('runtime.first_stream_completed');
    destroy$.next();
  });

  it('does not call a history load prior state when a run began while it was pending', async () => {
    const { transport, bridge, destroy$ } = setup();
    let resolveHistory!: (history: ThreadState[]) => void;
    transport.getHistory = () => new Promise(resolve => { resolveHistory = resolve; });
    bridge.switchThread('pending');
    const run = bridge.submit({});
    resolveHistory([makeThreadState('current-run-state')]);
    await Promise.resolve(); await Promise.resolve();
    expect(developmentEvidence.events).not.toContain('thread.persisted');
    destroy$.next(); transport.close(); await run;
  });
});

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', 'test', 'fixtures', 'streaming-reasoning-puzzle.json'),
    'utf8',
  ),
) as {
  thread_id: string;
  canonical_text_length: number;
  canonical_text: string;
  events: Array<{ event: string; data: unknown }>;
};

function makeSubjects(): StreamSubjects<Record<string, unknown>> {
  return {
    status$:          new BehaviorSubject(ResourceStatus.Idle),
    values$:          new BehaviorSubject({}),
    messages$:        new BehaviorSubject([]),
    error$:           new BehaviorSubject(undefined),
    interrupt$:       new BehaviorSubject(undefined),
    interrupts$:      new BehaviorSubject([]),
    branch$:          new BehaviorSubject(''),
    history$:         new BehaviorSubject([]),
    isThreadLoading$: new BehaviorSubject(false),
    toolProgress$:    new BehaviorSubject([]),
    toolCalls$:       new BehaviorSubject([]),
    messageMetadata$: new BehaviorSubject(new Map()),
    subagents$:       new BehaviorSubject(new Map()),
    queue$:           new BehaviorSubject({
      entries: [],
      size: 0,
      cancel: async () => false,
      clear: async () => undefined,
    }),
    custom$:          new BehaviorSubject<CustomStreamEvent[]>([]),
  };
}

function makeThreadState(
  checkpointId: string,
  parentCheckpointId: string | null = null,
): ThreadState<Record<string, unknown>> {
  return {
    values: { checkpointId },
    next: [],
    checkpoint: {
      thread_id: 'thread-1',
      checkpoint_ns: '',
      checkpoint_id: checkpointId,
      checkpoint_map: null,
    },
    metadata: null,
    created_at: `2026-05-02T00:00:0${checkpointId.length}.000Z`,
    parent_checkpoint: parentCheckpointId
      ? {
          thread_id: 'thread-1',
          checkpoint_ns: '',
          checkpoint_id: parentCheckpointId,
          checkpoint_map: null,
        }
      : null,
    tasks: [],
  };
}

describe('createStreamManagerBridge', () => {
  it('never reports custom-transport HTTP/network/TypeError lookalikes', async () => {
    for (const error of [
      Object.assign(new Error('application status'), { status: 401 }),
      new TypeError('ordinary app type error'),
      Object.assign(new Error('Unable to connect to LangGraph server.'), { name: 'ConnectionError' }),
    ]) {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const reportOperationFailure = vi.fn();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: new Subject<void>().asObservable(),
        reportOperationFailure,
      });

      const submitted = bridge.submit({});
      transport.emitError(error);
      await submitted;

      expect(reportOperationFailure).not.toHaveBeenCalled();
    }
  });

  it('does not retain a custom transport error merely because a key is configured', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        clientOptions: { apiKey: 'test-key-redact-me' },
      },
      subjects,
      threadId$: of('thread-1'),
      destroy$: new Subject<void>().asObservable(),
    });

    const submitted = bridge.submit({});
    transport.emitError(new Error('application error must remain local'));
    await submitted;

    expect(subjects.error$.value).toMatchObject({ cause: expect.any(Error) });
  });

  it('uses a closed telemetry error class and fails closed for hostile custom errors', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const seen: AgentRuntimeTelemetryPayload[] = [];
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        telemetry: payload => { seen.push(payload); },
      },
      subjects,
      threadId$: of('thread-1'),
      destroy$: new Subject<void>().asObservable(),
    });
    const hostile = new Proxy({}, {
      get() { throw new Error('test-key-redact-me'); },
      getOwnPropertyDescriptor() { throw new Error('test-key-redact-me'); },
    });

    const submitted = bridge.submit({});
    transport.emitError(hostile);
    await submitted;

    expect(subjects.error$.value).toBeInstanceOf(AgentError);
    expect(seen.find(payload => payload.event === 'tplane:stream_errored')?.properties)
      .toMatchObject({ errorClass: 'UnknownError' });
    expect(JSON.stringify(seen)).not.toContain('test-key-redact-me');
  });

  it('sanitizes structured stream and tool errors from the protected default transport', async () => {
    const sentinel = new Error('test-key-redact-me');
    const transport = new FetchStreamTransport(
      'https://runtime.example/api',
      undefined,
      { apiKey: 'test-key-redact-me', maxRetries: 0 },
    );
    Object.defineProperty(transport, 'client', {
      value: {
        runs: {
          stream: () => (async function* () {
            yield { event: 'tools', data: { event: 'on_tool_error', name: 'secret-tool', error: sentinel } };
            yield { event: 'error', data: { error: sentinel } };
          })(),
        },
        threads: {},
      },
    });
    const subjects = makeSubjects();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: 'https://runtime.example/api',
        assistantId: 'test',
        transport,
        clientOptions: { apiKey: 'test-key-redact-me' },
      },
      subjects,
      threadId$: of('thread-1'),
      destroy$: new Subject<void>().asObservable(),
    });

    await bridge.submit({});

    expect(subjects.error$.value).toMatchObject({
      message: 'The server ran into an error. You can try again.',
    });
    expect(subjects.error$.value?.cause).toBeUndefined();
    expect(subjects.toolProgress$.value).toContainEqual(
      expect.objectContaining({ error: 'The tool call failed.' }),
    );
    expect(JSON.stringify({
      error: subjects.error$.value,
      toolProgress: subjects.toolProgress$.value,
    })).not.toContain('test-key-redact-me');
  });

  it('creates a bridge with submit and stop methods', () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    expect(typeof bridge.submit).toBe('function');
    expect(typeof bridge.stop).toBe('function');
    expect(typeof bridge.resubmitLast).toBe('function');
    expect(typeof bridge.getMessageDelivery).toBe('function');
  });

  describe('message delivery lifecycle', () => {
    it('projects the first assistant chunk as streaming and normal completion as success', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-1', type: 'ai', content: 'hel' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      const streaming = bridge.getMessageDelivery('ai-1');
      expect(streaming).toEqual({
        generation: expect.any(String),
        phase: 'streaming',
      });

      transport.emit([{ type: 'values', values: { answer: 'hello' } }]);
      transport.close();
      expect(await submitted).toBe('success');

      expect(bridge.getMessageDelivery('ai-1')).toEqual({
        generation: streaming.generation,
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it('does not advance delivery revision for ordinary same-message token publication', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      void bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'revision-ai', type: 'ai', content: 'a' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const afterFirstChunk = bridge.deliveryRevision();

      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'revision-ai', type: 'ai', content: 'b' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      expect(bridge.deliveryRevision()).toBe(afterFirstChunk);
      await bridge.stop();
      destroy$.next();
    });

    it('preserves streamed identity and generation across a canonical history id swap', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const submitted = bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'streamed-id', type: 'ai', content: 'final answer' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      const streaming = bridge.getMessageDelivery('streamed-id');

      transport.history = [{
        values: {
          messages: [{ id: 'canonical-id', type: 'ai', content: 'final answer' }],
        },
        next: [],
        checkpoint: {
          thread_id: 'thread-1', checkpoint_ns: '', checkpoint_id: 'cp-final', checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-07-11T00:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never];
      transport.emit([{ type: 'values', values: { done: true } }]);
      transport.close();
      await submitted;

      expect(subjects.messages$.value).toEqual([
        expect.objectContaining({ id: 'streamed-id', content: 'final answer' }),
      ]);
      expect(bridge.getMessageDelivery('streamed-id')).toEqual({
        generation: streaming.generation,
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it('projects authoritative same-id content before publishing successful completion', async () => {
      let resolveFinalHistory!: (history: ThreadState<Record<string, unknown>>[]) => void;
      let historyCalls = 0;
      const finalHistory = new Promise<ThreadState<Record<string, unknown>>[]>(resolve => {
        resolveFinalHistory = resolve;
      });
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-authoritative', type: 'ai', content: 'streamed draft' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'values', values: { done: true } };
        },
        async getHistory() {
          historyCalls += 1;
          return historyCalls === 1 ? [] : finalHistory;
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const observations: Array<{
        content: unknown;
        generation: string;
        phase: string;
      }> = [];
      const recordObservation = () => {
        const message = subjects.messages$.value.find(candidate =>
          (candidate as unknown as { id?: string }).id === 'ai-authoritative'
        );
        if (!message) return;
        const delivery = bridge.getMessageDelivery('ai-authoritative');
        observations.push({
          content: (message as unknown as { content: unknown }).content,
          generation: delivery.generation,
          phase: delivery.phase,
        });
      };
      const messagesSubscription = subjects.messages$.subscribe(recordObservation);

      const submitted = bridge.submit({});
      await new Promise(resolve => setTimeout(resolve, 0));
      recordObservation();
      const attemptGeneration = bridge.getMessageDelivery('ai-authoritative').generation;

      resolveFinalHistory([{
        values: {
          messages: [{ id: 'ai-authoritative', type: 'ai', content: 'authoritative final' }],
        },
        next: [],
        checkpoint: {
          thread_id: 'thread-1', checkpoint_ns: '', checkpoint_id: 'cp-final', checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-07-12T00:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never]);
      await submitted;
      recordObservation();

      const completeContents = new Set(
        observations
          .filter(observation =>
            observation.generation === attemptGeneration && observation.phase === 'complete'
          )
          .map(observation => observation.content)
      );
      expect([...completeContents]).toEqual(['authoritative final']);

      messagesSubscription.unsubscribe();
      destroy$.next();
    });

    it('projects authoritative same-id content before publishing interrupted completion', async () => {
      let resolveFinalHistory!: (history: ThreadState<Record<string, unknown>>[]) => void;
      let historyCalls = 0;
      const finalHistory = new Promise<ThreadState<Record<string, unknown>>[]>(resolve => {
        resolveFinalHistory = resolve;
      });
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-interrupted-authoritative', type: 'ai', content: 'partial draft' }],
            messageMetadata: { langgraph_node: 'model' },
          };
        },
        async getHistory() {
          historyCalls += 1;
          return historyCalls === 1 ? [] : finalHistory;
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const observations: Array<{ content: unknown; generation: string; phase: string }> = [];
      const recordObservation = () => {
        const message = subjects.messages$.value.find(candidate =>
          (candidate as unknown as { id?: string }).id === 'ai-interrupted-authoritative'
        );
        if (!message) return;
        const delivery = bridge.getMessageDelivery('ai-interrupted-authoritative');
        observations.push({
          content: (message as unknown as { content: unknown }).content,
          generation: delivery.generation,
          phase: delivery.phase,
        });
      };
      const messagesSubscription = subjects.messages$.subscribe(recordObservation);

      const submitted = bridge.submit({});
      await new Promise(resolve => setTimeout(resolve, 0));
      recordObservation();
      const attemptGeneration = bridge.getMessageDelivery('ai-interrupted-authoritative').generation;

      resolveFinalHistory([{
        values: {
          messages: [{
            id: 'ai-interrupted-authoritative',
            type: 'ai',
            content: 'authoritative partial',
          }],
        },
        next: [],
        checkpoint: {
          thread_id: 'thread-1', checkpoint_ns: '', checkpoint_id: 'cp-interrupted', checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-07-12T00:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never]);
      await submitted;
      recordObservation();

      const completeContents = new Set(
        observations
          .filter(observation =>
            observation.generation === attemptGeneration && observation.phase === 'complete'
          )
          .map(observation => observation.content)
      );
      expect([...completeContents]).toEqual(['authoritative partial']);
      expect(bridge.getMessageDelivery('ai-interrupted-authoritative')).toMatchObject({
        generation: attemptGeneration,
        phase: 'complete',
        outcome: 'interrupted',
      });

      messagesSubscription.unsubscribe();
      destroy$.next();
    });

    it('stops an attempt waiting for authoritative history finalization', async () => {
      let historyCalls = 0;
      let finalHistorySignal: AbortSignal | undefined;
      let markFinalHistoryStarted = () => undefined;
      let releaseFinalHistory: ((history: ThreadState<Record<string, unknown>>[]) => void) | undefined;
      const finalHistoryStarted = new Promise<void>(resolve => { markFinalHistoryStarted = resolve; });
      const finalHistory = new Promise<ThreadState<Record<string, unknown>>[]>(resolve => {
        releaseFinalHistory = resolve;
      });
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-stop-final-sync', type: 'ai', content: 'answer' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'values', values: { done: true } };
        },
        async getHistory(_threadId, signal) {
          historyCalls += 1;
          if (historyCalls === 1) return [];
          finalHistorySignal = signal;
          markFinalHistoryStarted();
          return finalHistory;
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });
      await new Promise(resolve => setTimeout(resolve, 0));

      const submitted = bridge.submit({});
      await finalHistoryStarted;
      const generation = bridge.getMessageDelivery('ai-stop-final-sync').generation;

      await bridge.stop();
      const historyWasAborted = finalHistorySignal?.aborted;
      const submitResult = await Promise.race([
        submitted.then(() => 'resolved'),
        new Promise<'timed-out'>(resolve => setTimeout(() => resolve('timed-out'), 100)),
      ]);
      releaseFinalHistory?.([]);

      expect(historyWasAborted).toBe(true);
      expect(submitResult).toBe('resolved');
      expect(bridge.getMessageDelivery('ai-stop-final-sync')).toEqual({
        generation,
        phase: 'complete',
        outcome: 'aborted',
      });
      expect(subjects.status$.value).toBe(ResourceStatus.Idle);
      destroy$.next();
    });

    it('accepts an empty messages/complete event as normal terminal evidence', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-complete-marker', type: 'ai', content: 'answer' }],
        messageMetadata: { langgraph_node: 'model' },
      }, {
        type: 'messages/complete',
        messages: [],
      }]);
      transport.close();
      await submitted;

      expect(bridge.getMessageDelivery('ai-complete-marker')).toMatchObject({
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it.each([
      { type: 'values|child:node' as StreamEvent['type'], data: { done: true } },
      { type: 'messages/complete|child:node' as StreamEvent['type'], messages: [] },
      { type: 'checkpoints|child:node' as StreamEvent['type'], data: { checkpoint: 'cp-1' } },
    ])('does not accept namespaced $type as top-level terminal evidence', async (terminalEvent) => {
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-namespaced-marker', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield terminalEvent;
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.submit({});

      expect(bridge.getMessageDelivery('ai-namespaced-marker')).toMatchObject({
        phase: 'complete',
        outcome: 'interrupted',
      });
      destroy$.next();
    });

    it('accepts a null-payload top-level values event as terminal evidence', async () => {
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-null-values', type: 'ai', content: 'answer' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'values', data: null };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.submit({});

      expect(bridge.getMessageDelivery('ai-null-values')).toMatchObject({
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it('keeps interrupt-bearing top-level values paused', async () => {
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-values-interrupt', type: 'ai', content: 'waiting' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield {
            type: 'values',
            values: { __interrupt__: [{ id: 'approval', value: 'approve?' }] },
          };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});

      expect(await submitted).toBe('paused');

      expect(bridge.getMessageDelivery('ai-values-interrupt')).toMatchObject({
        phase: 'complete',
        outcome: 'paused',
      });
      destroy$.next();
    });

    it('marks an explicit runtime error event as complete/error', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-error', type: 'ai', content: 'partial' }],
        messageMetadata: { langgraph_node: 'model' },
      }, { type: 'error', error: new Error('rejected') }]);
      transport.close();
      expect(await submitted).toBe('error');

      expect(bridge.getMessageDelivery('ai-error')).toEqual({
        generation: expect.any(String),
        phase: 'complete',
        outcome: 'error',
      });
      destroy$.next();
    });

    it('marks a transport close after a chunk without a terminal event as interrupted', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-interrupted', type: 'ai', content: 'partial' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      transport.close();
      expect(await submitted).toBe('interrupted');

      expect(bridge.getMessageDelivery('ai-interrupted')).toEqual({
        generation: expect.any(String),
        phase: 'complete',
        outcome: 'interrupted',
      });
      destroy$.next();
    });

    it('does not treat a values snapshot before the first chunk as terminal evidence', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      transport.emit([
        { type: 'values', values: { initialized: true } },
        {
          type: 'messages',
          messages: [{ id: 'ai-after-initial-values', type: 'ai', content: 'partial' }],
          messageMetadata: { langgraph_node: 'model' },
        },
      ]);
      transport.close();
      await submitted;

      expect(bridge.getMessageDelivery('ai-after-initial-values')).toMatchObject({
        phase: 'complete',
        outcome: 'interrupted',
      });
      destroy$.next();
    });

    it('requires new terminal evidence after a new assistant step starts', async () => {
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-step-a', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'values', values: { step: 'a-complete' } };
          yield {
            type: 'messages',
            messages: [{ id: 'ai-step-b', type: 'ai', content: 'partial answer' }],
            messageMetadata: { langgraph_node: 'model' },
          };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.submit({});

      expect(bridge.getMessageDelivery('ai-step-b')).toMatchObject({
        phase: 'complete',
        outcome: 'interrupted',
      });
      destroy$.next();
    });

    it('marks a transport error after a chunk as interrupted without changing AgentError classification', async () => {
      const transport: AgentTransport = {
        async *stream() {
          yield {
            type: 'messages',
            messages: [{ id: 'ai-transport-error', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          throw new Error('HTTP 500: failed');
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.submit({});

      expect(bridge.getMessageDelivery('ai-transport-error')).toMatchObject({
        phase: 'complete',
        outcome: 'interrupted',
      });
      expect(subjects.error$.value).toBeInstanceOf(AgentError);
      expect((subjects.error$.value as AgentError).kind).toBe('server');
      destroy$.next();
    });

    it('marks user stop as complete/aborted', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-aborted', type: 'ai', content: 'partial' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      await bridge.stop();
      transport.close();

      expect(await submitted).toBe('aborted');

      expect(bridge.getMessageDelivery('ai-aborted')).toEqual({
        generation: expect.any(String),
        phase: 'complete',
        outcome: 'aborted',
      });
      destroy$.next();
    });

    it('marks HITL interruption as paused and allocates a new generation on resume', async () => {
      let run = 0;
      const transport: AgentTransport = {
        async *stream() {
          run += 1;
          yield {
            type: 'messages',
            messages: [{ id: 'ai-resume', type: 'ai', content: `partial-${run}` }],
            messageMetadata: { langgraph_node: 'model' },
          };
          if (run === 1) {
            yield { type: 'interrupt', interrupt: { id: 'approval', value: 'approve?' } };
          } else {
            yield { type: 'values', values: { done: true } };
          }
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.submit({});
      const paused = bridge.getMessageDelivery('ai-resume');
      expect(paused).toEqual({
        generation: expect.any(String),
        phase: 'complete',
        outcome: 'paused',
      });

      await bridge.submit(null, { command: { resume: true } });
      const resumed = bridge.getMessageDelivery('ai-resume');
      expect(resumed).toEqual({
        generation: expect.any(String),
        phase: 'complete',
        outcome: 'success',
      });
      expect(resumed.generation).not.toBe(paused.generation);
      destroy$.next();
    });

    it('allocates a new generation when retrying the same message id', async () => {
      let run = 0;
      const transport: AgentTransport = {
        async *stream() {
          run += 1;
          yield {
            type: 'messages',
            messages: [{ id: 'ai-retry', type: 'ai', content: `attempt-${run}` }],
            messageMetadata: { langgraph_node: 'model' },
          };
          if (run === 1) {
            yield { type: 'error', error: new Error('retry me') };
          } else {
            yield { type: 'values', values: { done: true } };
          }
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      expect(await bridge.submit({ retry: true })).toBe('error');
      const first = bridge.getMessageDelivery('ai-retry');
      expect(await bridge.resubmitLast()).toBe('success');
      const second = bridge.getMessageDelivery('ai-retry');

      expect(first).toMatchObject({ phase: 'complete', outcome: 'error' });
      expect(second).toMatchObject({ phase: 'complete', outcome: 'success' });
      expect(second.generation).not.toBe(first.generation);
      destroy$.next();
    });

    it('allocates fresh generations for direct and queued joined runs', async () => {
      const transport = new MockAgentTransport();
      transport.joinStream = async function* (threadId, runId) {
        this.joinedRuns.push({ threadId, runId });
        yield {
          type: 'messages',
          messages: [{ id: 'ai-joined-tail', type: 'ai', content: runId }],
          messageMetadata: { langgraph_node: 'model' },
        };
        yield { type: 'values', values: { runId } };
      };
      const subjects = makeSubjects();
      subjects.messages$.next([
        { id: 'ai-joined-tail', type: 'ai', content: 'prior partial' } as never,
      ]);
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.joinStream('direct-run');
      const direct = bridge.getMessageDelivery('ai-joined-tail');

      const active = bridge.submit({ active: true });
      await bridge.submit(
        { queued: true },
        { multitaskStrategy: 'enqueue' },
      );
      transport.emit([{ type: 'values', values: { active: true } }]);
      transport.close();
      await active;

      const queued = bridge.getMessageDelivery('ai-joined-tail');
      expect(direct).toMatchObject({ phase: 'complete', outcome: 'success' });
      expect(queued).toMatchObject({ phase: 'complete', outcome: 'success' });
      expect(direct.generation).not.toBe('ai-joined-tail');
      expect(queued.generation).not.toBe(direct.generation);
      destroy$.next();
    });

    it('keeps direct join explicit errors terminal', async () => {
      const transport: AgentTransport = {
        async *stream() { yield* []; },
        async *joinStream() {
          yield {
            type: 'messages',
            messages: [{ id: 'direct-error-ai', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'error', error: new Error('rejected') };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      await bridge.joinStream('direct-error-run');

      expect(bridge.getMessageDelivery('direct-error-ai')).toMatchObject({
        phase: 'complete', outcome: 'error',
      });
      expect(subjects.status$.value).toBe(ResourceStatus.Error);
      destroy$.next();
    });

    it('keeps queued join explicit errors terminal', async () => {
      const transport = new MockAgentTransport();
      transport.joinStream = async function* (threadId, runId) {
        this.joinedRuns.push({ threadId, runId });
        yield {
          type: 'messages',
          messages: [{ id: 'queued-error-ai', type: 'ai', content: 'partial' }],
          messageMetadata: { langgraph_node: 'model' },
        };
        yield { type: 'error', error: new Error('queued rejected') };
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const active = bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
      await bridge.submit(
        { messages: [{ type: 'human', content: 'queued' }] },
        { multitaskStrategy: 'enqueue' },
      );
      transport.emit([{ type: 'values', values: { active: true } }]);
      transport.close();
      await active;

      expect(bridge.getMessageDelivery('queued-error-ai')).toMatchObject({
        phase: 'complete', outcome: 'error',
      });
      expect(subjects.status$.value).toBe(ResourceStatus.Error);
      destroy$.next();
    });

    it('preserves submit error delivery and status when stopped before iterator close', async () => {
      let markErrorProcessed = () => undefined;
      const errorProcessed = new Promise<void>(resolve => { markErrorProcessed = resolve; });
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, _payload, signal) {
          yield {
            type: 'messages',
            messages: [{ id: 'submit-error-stop-ai', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'error', error: new Error('submit rejected') };
          markErrorProcessed();
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      await errorProcessed;
      await new Promise(resolve => setTimeout(resolve, 0));
      const errored = bridge.getMessageDelivery('submit-error-stop-ai');
      await bridge.stop();
      await submitted;

      expect(errored).toMatchObject({ phase: 'complete', outcome: 'error' });
      expect(bridge.getMessageDelivery('submit-error-stop-ai')).toEqual(errored);
      expect(subjects.status$.value).toBe(ResourceStatus.Error);
      destroy$.next();
    });

    it('preserves direct join error delivery and status when stopped before iterator close', async () => {
      let markErrorProcessed = () => undefined;
      const errorProcessed = new Promise<void>(resolve => { markErrorProcessed = resolve; });
      const transport: AgentTransport = {
        async *stream() { yield* []; },
        async *joinStream(_threadId, _runId, _lastEventId, signal) {
          yield {
            type: 'messages',
            messages: [{ id: 'direct-error-stop-ai', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'error', error: new Error('direct join rejected') };
          markErrorProcessed();
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const joined = bridge.joinStream('direct-error-stop-run');
      await errorProcessed;
      await new Promise(resolve => setTimeout(resolve, 0));
      const errored = bridge.getMessageDelivery('direct-error-stop-ai');
      await bridge.stop();
      await joined;

      expect(errored).toMatchObject({ phase: 'complete', outcome: 'error' });
      expect(bridge.getMessageDelivery('direct-error-stop-ai')).toEqual(errored);
      expect(subjects.status$.value).toBe(ResourceStatus.Error);
      destroy$.next();
    });

    it('preserves queued join error delivery and status when stopped before iterator close', async () => {
      let releaseInitial = () => undefined;
      let markErrorProcessed = () => undefined;
      const initialGate = new Promise<void>(resolve => { releaseInitial = resolve; });
      const errorProcessed = new Promise<void>(resolve => { markErrorProcessed = resolve; });
      const transport: AgentTransport = {
        async *stream() {
          await initialGate;
          yield { type: 'values', values: { initial: true } };
        },
        async createQueuedRun(_assistantId, threadId, values, _signal, options) {
          return { id: 'queued-error-stop-run', threadId, values, options, createdAt: new Date() };
        },
        async *joinStream(_threadId, _runId, _lastEventId, signal) {
          yield {
            type: 'messages',
            messages: [{ id: 'queued-error-stop-ai', type: 'ai', content: 'partial' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          yield { type: 'error', error: new Error('queued join rejected') };
          markErrorProcessed();
          await new Promise<void>(resolve => {
            if (signal.aborted) resolve();
            else signal.addEventListener('abort', () => resolve(), { once: true });
          });
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const initial = bridge.submit({ run: 'initial' });
      await bridge.submit({ run: 'queued' }, { multitaskStrategy: 'enqueue' });
      releaseInitial();
      await errorProcessed;
      await new Promise(resolve => setTimeout(resolve, 0));
      const errored = bridge.getMessageDelivery('queued-error-stop-ai');
      await bridge.stop();
      await initial;

      expect(errored).toMatchObject({ phase: 'complete', outcome: 'error' });
      expect(bridge.getMessageDelivery('queued-error-stop-ai')).toEqual(errored);
      expect(subjects.status$.value).toBe(ResourceStatus.Error);
      destroy$.next();
    });

    it.each([false, true])(
      'treats direct join user stop as aborted when transport throws=%s',
      async (throwOnAbort) => {
        const transport: AgentTransport = {
          async *stream() { yield* []; },
          async *joinStream(_threadId, _runId, _lastEventId, signal) {
            yield {
              type: 'messages',
              messages: [{ id: 'direct-abort-ai', type: 'ai', content: 'partial' }],
              messageMetadata: { langgraph_node: 'model' },
            };
            await new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            if (throwOnAbort) {
              const error = new Error('aborted');
              error.name = 'AbortError';
              throw error;
            }
          },
        };
        const subjects = makeSubjects();
        const destroy$ = new Subject<void>();
        const bridge = createStreamManagerBridge({
          options: { apiUrl: '', assistantId: 'test', transport },
          subjects,
          threadId$: of('thread-1'),
          destroy$: destroy$.asObservable(),
        });

        const joined = bridge.joinStream('direct-abort-run');
        await new Promise(resolve => setTimeout(resolve, 0));
        await bridge.stop();
        await joined;

        expect(bridge.getMessageDelivery('direct-abort-ai')).toMatchObject({
          phase: 'complete', outcome: 'aborted',
        });
        expect(subjects.status$.value).toBe(ResourceStatus.Idle);
        expect(subjects.error$.value).toBeUndefined();
        destroy$.next();
      },
    );

    it('finalizes the earlier tool-loop assistant step before exposing the next step', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      void bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-tool-call', type: 'ai', content: 'search', tool_calls: [{ id: 'call-1', name: 'search', args: {} }] }],
        messageMetadata: { langgraph_node: 'model' },
      }]);
      expect(bridge.getMessageDelivery('ai-tool-call').phase).toBe('streaming');

      transport.emit([{ type: 'values', values: { toolStepComplete: true } }]);
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'ai-final', type: 'ai', content: 'search complete' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      expect(bridge.getMessageDelivery('ai-tool-call')).toMatchObject({
        phase: 'complete',
        outcome: 'success',
      });
      expect(bridge.getMessageDelivery('ai-final')).toMatchObject({ phase: 'streaming' });
      await bridge.stop();
      destroy$.next();
    });

    it('merges cross-id chunks within the same tool-calling assistant step', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      void bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{
          id: 'tool-chunk-a', type: 'ai', content: 'hel',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'ang' } }],
        }],
        messageMetadata: { langgraph_node: 'model' },
      }, {
        type: 'messages',
        messages: [{
          id: 'tool-chunk-b', type: 'ai', content: 'lo',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'angular' } }],
        }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      expect(subjects.messages$.value).toEqual([
        expect.objectContaining({
          id: 'tool-chunk-a',
          content: 'hello',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'angular' } }],
        }),
      ]);
      expect(bridge.getMessageDelivery('tool-chunk-a')).toEqual({
        generation: expect.any(String),
        phase: 'streaming',
      });
      expect(bridge.getMessageDelivery('tool-chunk-b')).toEqual({
        generation: 'tool-chunk-b',
        phase: 'complete',
        outcome: 'success',
      });

      await bridge.stop();
      destroy$.next();
    });

    it('tracks delivery on the displayed id when per-chunk event ids are merged', async () => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      const submitted = bridge.submit({});
      await transport.emit([{
        type: 'messages',
        messages: [{ id: 'chunk-event-1', type: 'ai', content: 'hel' }],
        messageMetadata: { langgraph_node: 'model' },
      }, {
        type: 'messages',
        messages: [{ id: 'chunk-event-2', type: 'ai', content: 'lo' }],
        messageMetadata: { langgraph_node: 'model' },
      }]);

      expect(subjects.messages$.value).toEqual([
        expect.objectContaining({ id: 'chunk-event-1', content: 'hello' }),
      ]);
      const streaming = bridge.getMessageDelivery('chunk-event-1');
      expect(streaming).toEqual({
        generation: expect.any(String),
        phase: 'streaming',
      });
      expect(bridge.getMessageDelivery('chunk-event-2')).toEqual({
        generation: 'chunk-event-2',
        phase: 'complete',
        outcome: 'success',
      });

      transport.emit([{ type: 'values', values: { done: true } }]);
      transport.close();
      await submitted;

      expect(bridge.getMessageDelivery('chunk-event-1')).toEqual({
        generation: streaming.generation,
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it.each(['error', 'paused', 'aborted', 'interrupted'] as const)(
      'preserves an earlier tool-loop step success when the active step ends %s',
      async (outcome) => {
        const transport = new MockAgentTransport();
        const subjects = makeSubjects();
        const destroy$ = new Subject<void>();
        const bridge = createStreamManagerBridge({
          options: { apiUrl: '', assistantId: 'test', transport },
          subjects,
          threadId$: of(null),
          destroy$: destroy$.asObservable(),
        });

        const submitted = bridge.submit({});
        await transport.emit([{
          type: 'messages',
          messages: [{
            id: 'ai-earlier', type: 'ai', content: '',
            tool_calls: [{ id: 'call-boundary', name: 'search', args: {} }],
          }],
          messageMetadata: { langgraph_node: 'model' },
        }, {
          type: 'messages',
          messages: [{
            id: 'tool-boundary', type: 'tool', tool_call_id: 'call-boundary', content: 'result',
          }],
          messageMetadata: { langgraph_node: 'tools' },
        }, {
          type: 'messages',
          messages: [{ id: 'ai-active', type: 'ai', content: 'partial' }],
          messageMetadata: { langgraph_node: 'model' },
        }]);

        if (outcome === 'error') {
          transport.emit([{ type: 'error', error: new Error('failed') }]);
          transport.close();
        } else if (outcome === 'paused') {
          transport.emit([{ type: 'interrupt', interrupt: { id: 'approval', value: 'approve?' } }]);
          transport.close();
        } else if (outcome === 'aborted') {
          await bridge.stop();
          transport.close();
        } else {
          transport.close();
        }
        await submitted;

        expect(bridge.getMessageDelivery('ai-earlier')).toMatchObject({
          phase: 'complete',
          outcome: 'success',
        });
        expect(bridge.getMessageDelivery('ai-active')).toMatchObject({
          phase: 'complete',
          outcome,
        });
        destroy$.next();
      },
    );
  });

  describe('submit outcomes and retry state', () => {
    it('retries a failed null-payload resume with its captured command and a fresh signal', async () => {
      const requests: Array<{ payload: unknown; command: unknown; aborted: boolean }> = [];
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, payload, signal, options) {
          requests.push({ payload, command: structuredClone(options?.command), aborted: signal?.aborted ?? false });
          if (requests.length === 1) throw new Error('connection failed');
          yield { type: 'values', values: { done: true } };
        },
      };
      const destroy$ = new Subject<void>();
      const controller = new AbortController();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects: makeSubjects(), threadId$: of('thread-1'), destroy$,
      });
      const command = { resume: { approved: true }, update: { amount: 12 } };
      expect(await bridge.submit(null, { command, signal: controller.signal })).toBe('error');
      command.resume.approved = false;
      command.update.amount = 99;
      controller.abort();
      expect(await bridge.resubmitLast()).toBe('success');
      expect(requests).toEqual([
        { payload: null, command: { resume: { approved: true }, update: { amount: 12 } }, aborted: false },
        { payload: null, command: { resume: { approved: true }, update: { amount: 12 } }, aborted: false },
      ]);
      destroy$.next();
    });

    it('does not replay retained input after disposal', async () => {
      const transport = new MockAgentTransport();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects: makeSubjects(), threadId$: of('thread-1'), destroy$,
      });
      const run = bridge.submit({ messages: [] });
      transport.close();
      await run;
      destroy$.next();
      expect(await bridge.resubmitLast()).toBe('not-started');
    });

    it('returns not-started without a retained non-null payload', async () => {
      let streamCalls = 0;
      const transport: AgentTransport = {
        async *stream() {
          streamCalls += 1;
          yield { type: 'values', values: { unexpected: true } };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      expect(await bridge.resubmitLast()).toBe('not-started');
      expect(streamCalls).toBe(0);
      destroy$.next();
    });

    it('clears retry state for immediate null and undefined submissions', async () => {
      const streamPayloads: unknown[] = [];
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, payload) {
          streamPayloads.push(payload);
          yield { type: 'values', values: { completed: streamPayloads.length } };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const beforeNull = { run: 'before-null' };
      expect(await bridge.submit(beforeNull)).toBe('success');
      expect(await bridge.submit(null)).toBe('success');
      expect(await bridge.resubmitLast()).toBe('not-started');

      const beforeUndefined = { run: 'before-undefined' };
      expect(await bridge.submit(beforeUndefined)).toBe('success');
      expect(await bridge.submit(undefined)).toBe('success');
      expect(await bridge.resubmitLast()).toBe('not-started');
      expect(streamPayloads).toEqual([beforeNull, null, beforeUndefined, undefined]);
      destroy$.next();
    });

    it('uses stream while idle for enqueue options and returns the stream outcome', async () => {
      let streamCalls = 0;
      const transport: AgentTransport = {
        async *stream() {
          streamCalls += 1;
          yield { type: 'error', error: new Error('stream failed') };
        },
        async createQueuedRun() {
          throw new Error('enqueue should not run while idle');
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      expect(await bridge.submit({ run: 'idle' }, { multitaskStrategy: 'enqueue' })).toBe('error');
      expect(streamCalls).toBe(1);
      expect(subjects.queue$.value.size).toBe(0);
      destroy$.next();
    });

    it('returns success for a queued active run without replacing the active retry input', async () => {
      const calls: Array<{ payload: unknown; options: unknown }> = [];
      let releaseActive!: () => void;
      const activeGate = new Promise<void>(resolve => { releaseActive = resolve; });
      const activePayload = { run: 'active' };
      const activeOptions = { context: { source: 'active' } };
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, payload, signal, options) {
          calls.push({ payload, options });
          if (calls.length === 1) {
            const aborted = new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            await Promise.race([activeGate, aborted]);
            return;
          }
          yield { type: 'values', values: { retried: true } };
        },
        async createQueuedRun(_assistantId, threadId, values, _signal, options) {
          return { id: 'queued-1', threadId, values, options, createdAt: new Date() };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const active = bridge.submit(activePayload, activeOptions);
      const queuedOutcome = await bridge.submit(
        { run: 'queued' },
        { multitaskStrategy: 'enqueue' },
      );
      const resubmitOutcome = await bridge.resubmitLast();
      releaseActive();
      const activeOutcome = await active;

      expect(queuedOutcome).toBe('success');
      expect(resubmitOutcome).toBe('success');
      expect(activeOutcome).toBe('interrupted');
      expect(calls).toEqual([
        { payload: activePayload, options: activeOptions },
        { payload: activePayload, options: activeOptions },
      ]);
      destroy$.next();
    });

    it('keeps the active retry input when queue creation fails', async () => {
      const calls: Array<{ payload: unknown; options: unknown }> = [];
      let releaseActive!: () => void;
      const activeGate = new Promise<void>(resolve => { releaseActive = resolve; });
      const activePayload = { run: 'active' };
      const activeOptions = { context: { source: 'active' } };
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, payload, signal, options) {
          calls.push({ payload, options });
          if (calls.length === 1) {
            const aborted = new Promise<void>(resolve => {
              if (signal.aborted) resolve();
              else signal.addEventListener('abort', () => resolve(), { once: true });
            });
            await Promise.race([activeGate, aborted]);
            return;
          }
          yield { type: 'values', values: { retried: true } };
        },
        async createQueuedRun() {
          throw new Error('queue creation failed');
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const active = bridge.submit(activePayload, activeOptions);
      const queueResult = await bridge.submit(
        { run: 'queued' },
        { multitaskStrategy: 'enqueue' },
      ).then(
        value => ({ status: 'fulfilled' as const, value }),
        error => ({ status: 'rejected' as const, error }),
      );
      const resubmitOutcome = await bridge.resubmitLast();
      releaseActive();
      const activeOutcome = await active;

      expect(queueResult).toMatchObject({
        status: 'rejected',
        error: new Error('queue creation failed'),
      });
      expect(resubmitOutcome).toBe('success');
      expect(activeOutcome).toBe('interrupted');
      expect(calls).toEqual([
        { payload: activePayload, options: activeOptions },
        { payload: activePayload, options: activeOptions },
      ]);
      destroy$.next();
    });

    it('clears retry state when switching threads', async () => {
      let streamCalls = 0;
      const transport: AgentTransport = {
        async *stream() {
          streamCalls += 1;
          yield { type: 'values', values: { completed: true } };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      expect(await bridge.submit({ run: 'thread-1' })).toBe('success');
      bridge.switchThread('thread-2');

      expect(await bridge.resubmitLast()).toBe('not-started');
      expect(streamCalls).toBe(1);
      destroy$.next();
    });
  });

  it('sets status to Loading when submit is called', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    bridge.submit({ messages: [] });
    expect(subjects.status$.value).toBe(ResourceStatus.Loading);
    destroy$.next();
  });

  it('passes submit options through to the transport stream', async () => {
    const seen: Array<{ payload: unknown; options: unknown }> = [];
    const transport: AgentTransport = {
      async *stream(_assistantId, _threadId, payload, _signal, options?: unknown) {
        seen.push({ payload, options });
        yield* [];
      },
    } as AgentTransport;
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    await bridge.submit(null, {
      checkpoint: {
        checkpoint_ns: '',
        checkpoint_id: 'checkpoint-1',
        checkpoint_map: null,
      },
      command: { resume: { approved: true } },
      metadata: { source: 'ui' },
    });

    expect(seen).toEqual([
      {
        payload: null,
        options: expect.objectContaining({
          checkpoint: {
            checkpoint_ns: '',
            checkpoint_id: 'checkpoint-1',
            checkpoint_map: null,
          },
          command: { resume: { approved: true } },
          metadata: { source: 'ui' },
        }),
      },
    ]);
    destroy$.next();
  });

  it('emits opt-in telemetry around completed LangGraph streams', async () => {
    const seen: AgentRuntimeTelemetryPayload[] = [];
    const transport: AgentTransport = {
      async *stream() {
        yield { type: 'values', values: { ok: true } };
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        telemetry: (payload) => seen.push(payload),
      },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    await bridge.submit({ messages: [] });

    expect(seen.map((payload) => payload.event)).toEqual([
      'tplane:runtime_instance_created',
      'tplane:runtime_request_created',
      'tplane:stream_started',
      'tplane:stream_ended',
    ]);
    expect(seen[0].properties).toEqual({ transport: 'langgraph', surface: 'agent' });
    expect(seen[1].properties).toEqual({ transport: 'langgraph', surface: 'agent', requestType: 'submit' });
    expect(seen[2].properties).toEqual({ transport: 'langgraph', surface: 'agent' });
    expect(seen[3].properties).toEqual({
      transport: 'langgraph',
      surface: 'agent',
      durationMs: expect.any(Number),
    });
    destroy$.next();
  });

  it('emits opt-in telemetry for LangGraph stream failures without error messages', async () => {
    const seen: AgentRuntimeTelemetryPayload[] = [];
    const transport: AgentTransport = {
      async *stream() {
        yield* [];
        throw new TypeError('secret prompt fragment');
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        telemetry: (payload) => seen.push(payload),
      },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    await bridge.submit({ messages: [] });

    const errored = seen.find((payload) => payload.event === 'tplane:stream_errored');
    expect(errored?.properties).toEqual({
      transport: 'langgraph',
      surface: 'agent',
      durationMs: expect.any(Number),
      errorClass: 'Error',
    });
    expect(JSON.stringify(seen)).not.toContain('secret prompt fragment');
    destroy$.next();
  });

  it('loads history when initialized with a thread id', async () => {
    const history = [makeThreadState('checkpoint-1')];
    const historyCalls: string[] = [];
    const transport: AgentTransport & {
      getHistory: (threadId: string, signal: AbortSignal) => Promise<ThreadState<Record<string, unknown>>[]>;
    } = {
      async *stream() {
        yield* [];
      },
      async getHistory(threadId, signal) {
        expect(signal.aborted).toBe(false);
        historyCalls.push(threadId);
        return history;
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();

    createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });
    await new Promise(r => setTimeout(r, 10));

    expect(historyCalls).toEqual(['thread-1']);
    expect(subjects.history$.value).toBe(history);
    expect(subjects.isThreadLoading$.value).toBe(false);
    destroy$.next();
  });

  it('populates messages$ and values$ from the latest checkpoint on initial connect', async () => {
    const transport = new MockAgentTransport();
    transport.history = [
      {
        values: {
          messages: [
            { type: 'human', id: 'u-1', content: 'previous question', _getType: () => 'human' },
            { type: 'ai',    id: 'a-1', content: 'previous answer',   _getType: () => 'ai' },
          ],
          model: 'gpt-5-mini',
          reasoning_effort: 'medium',
        },
        next: [],
        checkpoint: {
          thread_id: 'persisted-thread-1',
          checkpoint_ns: '',
          checkpoint_id: 'cp-1',
          checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-05-08T12:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never,
    ];

    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();

    createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'chat', transport },
      subjects,
      threadId$: of('persisted-thread-1'),
      destroy$: destroy$.asObservable(),
    });

    // Wait for the refreshHistory promise chain to resolve.
    await new Promise(r => setTimeout(r, 10));

    expect(subjects.messages$.value.length).toBe(2);
    expect((subjects.messages$.value[0] as { content: unknown }).content).toBe('previous question');
    expect((subjects.messages$.value[1] as { content: unknown }).content).toBe('previous answer');

    const values = subjects.values$.value as Record<string, unknown>;
    expect(values['model']).toBe('gpt-5-mini');
    expect(values['reasoning_effort']).toBe('medium');
    expect(values).not.toHaveProperty('messages');

    destroy$.next();
  });

  it('does not clobber local optimistic messages if a submit beats the history fetch', async () => {
    const historyFetched: ThreadState<Record<string, unknown>>[] = [
      {
        values: {
          messages: [
            { type: 'human', id: 'old-u', content: 'old prompt', _getType: () => 'human' },
          ],
        },
        next: [],
        checkpoint: {
          thread_id: 'persisted-thread-2',
          checkpoint_ns: '',
          checkpoint_id: 'cp-old',
          checkpoint_map: null,
        },
        metadata: null,
        created_at: '2026-05-08T12:00:00.000Z',
        parent_checkpoint: null,
        tasks: [],
      } as never,
    ];

    // Inline mock transport with a delayed getHistory so we can observe
    // a state mutation between threadId-set and history resolution.
    const transport: AgentTransport & {
      getHistory: (
        threadId: string,
        signal: AbortSignal,
      ) => Promise<ThreadState<Record<string, unknown>>[]>;
    } = {
      async *stream() {
        yield* [];
      },
      async getHistory(_threadId, _signal) {
        await new Promise(r => setTimeout(r, 50));
        return historyFetched;
      },
    };

    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();

    createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'chat', transport },
      subjects,
      threadId$: of('persisted-thread-2'),
      destroy$: destroy$.asObservable(),
    });

    // Synchronously simulate an optimistic local submit BEFORE history
    // resolves: the user clicks Send during the 50ms history fetch.
    subjects.messages$.next([
      { type: 'human', id: 'fresh', content: 'fresh prompt', _getType: () => 'human' },
    ] as never);

    // Wait past the history fetch delay.
    await new Promise(r => setTimeout(r, 80));

    // Local optimistic message preserved; history projection skipped.
    expect(subjects.messages$.value.length).toBe(1);
    expect((subjects.messages$.value[0] as { content: unknown }).content).toBe('fresh prompt');

    destroy$.next();
  });

  it('refreshes history after a stream completes', async () => {
    const firstHistory = [makeThreadState('checkpoint-1')];
    const secondHistory = [
      makeThreadState('checkpoint-1'),
      makeThreadState('checkpoint-2', 'checkpoint-1'),
    ];
    let historyCalls = 0;
    const transport: AgentTransport & {
      getHistory: (threadId: string, signal: AbortSignal) => Promise<ThreadState<Record<string, unknown>>[]>;
    } = {
      async *stream() {
        yield { type: 'values', values: { answer: 42 } };
      },
      async getHistory() {
        historyCalls += 1;
        return historyCalls === 1 ? firstHistory : secondHistory;
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });
    await new Promise(r => setTimeout(r, 10));

    await bridge.submit({ messages: [] });

    expect(historyCalls).toBe(2);
    expect(subjects.history$.value).toBe(secondHistory);
    destroy$.next();
  });

  it('exposes enqueue submissions through queue$ without starting a second stream immediately', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
    await bridge.submit(
      { messages: [{ type: 'human', content: 'queued' }] },
      { multitaskStrategy: 'enqueue' },
    );

    expect(subjects.queue$.value.size).toBe(1);
    expect(subjects.queue$.value.entries[0]).toMatchObject({
      values: { messages: [{ type: 'human', content: 'queued' }] },
    });
    expect(transport.createdQueuedRuns).toHaveLength(1);
    expect(transport.isStreaming()).toBe(true);
    destroy$.next();
  });

  it('can cancel a queued run through queue$', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
    await bridge.submit(
      { messages: [{ type: 'human', content: 'queued' }] },
      { multitaskStrategy: 'enqueue' },
    );

    const queued = subjects.queue$.value.entries[0];
    await subjects.queue$.value.cancel(queued.id);

    expect(subjects.queue$.value.size).toBe(0);
    expect(transport.cancelledRuns).toEqual([{ threadId: 'thread-1', runId: queued.id }]);
    destroy$.next();
  });

  it('cancels queued runs when switching threads', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
    await bridge.submit(
      { messages: [{ type: 'human', content: 'queued' }] },
      { multitaskStrategy: 'enqueue' },
    );

    bridge.switchThread('thread-2');
    await Promise.resolve();

    expect(subjects.queue$.value.size).toBe(0);
    expect(transport.cancelledRuns).toEqual([{ threadId: 'thread-1', runId: 'queued-run-1' }]);
    destroy$.next();
  });

  it('cancels queued runs when stopping the active stream', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
    await bridge.submit(
      { messages: [{ type: 'human', content: 'queued' }] },
      { multitaskStrategy: 'enqueue' },
    );

    await bridge.stop();

    expect(subjects.queue$.value.size).toBe(0);
    expect(transport.cancelledRuns).toEqual([{ threadId: 'thread-1', runId: 'queued-run-1' }]);
    destroy$.next();
  });

  it('joins queued runs in FIFO order after the active stream completes', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'active' }] });
    await bridge.submit(
      { messages: [{ type: 'human', content: 'queued' }] },
      { multitaskStrategy: 'enqueue' },
    );

    transport.close();
    await new Promise(r => setTimeout(r, 20));

    expect(transport.joinedRuns).toEqual([{ threadId: 'thread-1', runId: 'queued-run-1' }]);
    expect(subjects.queue$.value.size).toBe(0);
    expect(subjects.values$.value).toMatchObject({ queued: true });
    destroy$.next();
  });

  it('does not let a stale queue drain interrupt a replacement submit', async () => {
    let releaseInitial = () => undefined;
    let releaseFirstJoin = () => undefined;
    let releaseReplacement = () => undefined;
    let markFirstJoinStarted = () => undefined;
    const initialGate = new Promise<void>(resolve => { releaseInitial = resolve; });
    const firstJoinGate = new Promise<void>(resolve => { releaseFirstJoin = resolve; });
    const replacementGate = new Promise<void>(resolve => { releaseReplacement = resolve; });
    const firstJoinStarted = new Promise<void>(resolve => { markFirstJoinStarted = resolve; });
    let queuedRun = 0;
    const joinedRuns: string[] = [];
    const transport: AgentTransport = {
      async *stream(_assistantId, _threadId, payload, signal) {
        if ((payload as { run: string }).run === 'initial') {
          await initialGate;
          yield { type: 'values', values: { initial: true } };
          return;
        }
        yield {
          type: 'messages',
          messages: [{ id: 'replacement-ai', type: 'ai', content: 'replacement' }],
          messageMetadata: { langgraph_node: 'model' },
        };
        await replacementGate;
        if (!signal.aborted) yield { type: 'values', values: { replacement: true } };
      },
      async createQueuedRun(_assistantId, threadId, values, _signal, options) {
        queuedRun += 1;
        return {
          id: `queued-${queuedRun}`,
          threadId,
          values,
          options,
          createdAt: new Date(),
        };
      },
      async *joinStream(_threadId, runId) {
        joinedRuns.push(runId);
        if (runId === 'queued-1') {
          yield {
            type: 'messages',
            messages: [{ id: 'queued-one-ai', type: 'ai', content: 'queued one' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          markFirstJoinStarted();
          await firstJoinGate;
          return;
        }
        yield { type: 'values', values: { queuedTwo: true } };
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    const initial = bridge.submit({ run: 'initial' });
    await bridge.submit({ run: 'queued-1' }, { multitaskStrategy: 'enqueue' });
    await bridge.submit({ run: 'queued-2' }, { multitaskStrategy: 'enqueue' });
    releaseInitial();
    await firstJoinStarted;

    const replacement = bridge.submit({ run: 'replacement' });
    await new Promise(resolve => setTimeout(resolve, 0));
    const replacementStreaming = bridge.getMessageDelivery('replacement-ai');
    releaseFirstJoin();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(joinedRuns).toEqual(['queued-1']);
    expect(bridge.getMessageDelivery('replacement-ai')).toEqual(replacementStreaming);
    expect(replacementStreaming).toMatchObject({ phase: 'streaming' });
    expect(subjects.status$.value).toBe(ResourceStatus.Loading);

    releaseReplacement();
    expect(await replacement).toBe('success');
    await initial;
    expect(joinedRuns).toEqual(['queued-1', 'queued-2']);
    destroy$.next();
  });

  it('sets status to Resolved when stream completes', async () => {
    const transport = new MockAgentTransport([
      [{ type: 'values', values: { count: 1 } }],
    ]);
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    // Do NOT await submit — it only resolves after the stream ends.
    // Close the transport first so the async generator terminates,
    // then await a tick for the status update to propagate.
    bridge.submit({ messages: [] });
    // The scripted snapshot is what makes this a completion rather than an
    // interruption — a close that emitted nothing proves nothing finished.
    transport.emit(transport.nextBatch());
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(subjects.status$.value).toBe(ResourceStatus.Resolved);
    destroy$.next();
  });

  it('updates values$ when values event received', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    transport.emit([{ type: 'values', values: { answer: 42 } }]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(subjects.values$.value).toMatchObject({ answer: 42 });
    destroy$.next();
  });

  it('sets status to Error on transport error', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    transport.emitError(new Error('network fail'));
    await new Promise(r => setTimeout(r, 10));
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    expect(subjects.error$.value).toBeInstanceOf(Error);
    destroy$.next();
  });

  it.each(['messages/partial', 'messages/complete'] as const)(
    'updates messages$ when SDK %s events are received',
    async (type) => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      bridge.submit({});
      transport.emit([{
        type,
        data: [{ id: '1', type: 'human', content: 'hi' }, { langgraph_node: 'respond' }],
      } as any]);
      transport.close();

      await new Promise(r => setTimeout(r, 10));

      expect(subjects.messages$.value).toHaveLength(1);
      expect(subjects.messages$.value[0]).toMatchObject({ content: 'hi' });
      destroy$.next();
    }
  );

  it.each(['messages/partial', 'messages/complete'] as const)(
    'filters metadata from normalized SDK %s events (messages array path)',
    async (type) => {
      const transport = new MockAgentTransport();
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: { apiUrl: '', assistantId: 'test', transport },
        subjects,
        threadId$: of(null),
        destroy$: destroy$.asObservable(),
      });

      bridge.submit({});
      // Simulate post-normalizeSdkEvent shape: messages array includes metadata
      // This is what FetchStreamTransport produces in production
      transport.emit([{
        type,
        messages: [
          { id: 'ai-1', type: 'ai', content: 'Hello' },
          { langgraph_node: 'chatbot', langgraph_triggers: ['start:chatbot'] },
        ],
        data: [
          { id: 'ai-1', type: 'ai', content: 'Hello' },
          { langgraph_node: 'chatbot', langgraph_triggers: ['start:chatbot'] },
        ],
      } as any]);
      transport.close();

      await new Promise(r => setTimeout(r, 10));

      // Only the real message should be in messages$, not the metadata
      expect(subjects.messages$.value).toHaveLength(1);
      expect(subjects.messages$.value[0]).toMatchObject({ id: 'ai-1', content: 'Hello' });
      destroy$.next();
    }
  );

    it('does not accumulate metadata across multiple messages/partial events', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});

    // First values event — sets up the human message
    transport.emit([{
      type: 'values',
      values: { messages: [{ id: 'h-1', type: 'human', content: 'hi' }] },
    } as any]);

    // Simulate multiple messages/partial events (production SDK shape)
    for (let i = 0; i < 5; i++) {
      transport.emit([{
        type: 'messages/partial',
        messages: [
          { id: 'ai-1', type: 'ai', content: 'Hello'.slice(0, i + 1) },
          { langgraph_node: 'chatbot' },
        ],
        data: [
          { id: 'ai-1', type: 'ai', content: 'Hello'.slice(0, i + 1) },
          { langgraph_node: 'chatbot' },
        ],
      } as any]);
    }

    transport.close();
    await new Promise(r => setTimeout(r, 10));

    // Should only have human + AI messages, no accumulated metadata
    expect(subjects.messages$.value).toHaveLength(2);
    expect(subjects.messages$.value[0]).toMatchObject({ id: 'h-1', content: 'hi' });
    expect(subjects.messages$.value[1]).toMatchObject({ id: 'ai-1', content: 'Hello' });
      destroy$.next();
    });

    it.each(['messages/partial', 'messages/complete'] as const)(
      'does not retag historical assistants from a full %s snapshot',
      async (type) => {
        const transport = new MockAgentTransport();
        const subjects = makeSubjects();
        subjects.messages$.next([
          { id: 'historical-ai', type: 'ai', content: 'old answer' } as never,
          { id: 'historical-user', type: 'human', content: 'new question' } as never,
        ]);
        const destroy$ = new Subject<void>();
        const bridge = createStreamManagerBridge({
          options: { apiUrl: '', assistantId: 'test', transport },
          subjects,
          threadId$: of(null),
          destroy$: destroy$.asObservable(),
        });

        void bridge.submit({});
        await transport.emit([{
          type,
          messages: [
            { id: 'historical-ai', type: 'ai', content: 'old answer' },
            { id: 'historical-user', type: 'human', content: 'new question' },
            { id: 'active-ai', type: 'ai', content: 'new answer' },
          ],
        }]);

        expect(bridge.getMessageDelivery('historical-ai')).toEqual({
          generation: 'historical-ai',
          phase: 'complete',
          outcome: 'success',
        });
        expect(bridge.getMessageDelivery('active-ai')).toEqual({
          generation: expect.any(String),
          phase: 'streaming',
        });
        await bridge.stop();
        destroy$.next();
      },
    );

    it.each(['messages/partial', 'messages/complete'] as const)(
      'does not retag an enriched historical assistant from a full %s snapshot',
      async (type) => {
        const transport = new MockAgentTransport();
        const subjects = makeSubjects();
        subjects.messages$.next([
          { id: 'historical-enriched-ai', type: 'ai', content: 'old answer' } as never,
          { id: 'historical-enriched-user', type: 'human', content: 'new question' } as never,
        ]);
        const destroy$ = new Subject<void>();
        const bridge = createStreamManagerBridge({
          options: { apiUrl: '', assistantId: 'test', transport },
          subjects,
          threadId$: of(null),
          destroy$: destroy$.asObservable(),
        });
        const historicalDelivery = bridge.getMessageDelivery('historical-enriched-ai');

        void bridge.submit({});
        await transport.emit([{
          type,
          messages: [
            {
              id: 'historical-enriched-ai',
              type: 'ai',
              content: 'old answer enriched',
              reasoning: 'retrospective reasoning',
              tool_calls: [{ id: 'historical-call', name: 'lookup', args: { query: 'old' } }],
            },
            { id: 'historical-enriched-user', type: 'human', content: 'new question' },
            { id: 'active-enriched-ai', type: 'ai', content: 'new answer' },
          ],
        }]);

        expect(subjects.messages$.value.find(message =>
          (message as unknown as { id?: string }).id === 'historical-enriched-ai'
        )).toMatchObject({
          content: 'old answer enriched',
          reasoning: 'retrospective reasoning',
          tool_calls: [{ id: 'historical-call', name: 'lookup', args: { query: 'old' } }],
        });
        expect(bridge.getMessageDelivery('historical-enriched-ai')).toEqual(historicalDelivery);
        expect(bridge.getMessageDelivery('active-enriched-ai')).toEqual({
          generation: expect.any(String),
          phase: 'streaming',
        });
        await bridge.stop();
        destroy$.next();
      },
    );

    it('ignores late events from the previous stream after threadId changes', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const threadId$ = new BehaviorSubject<string | null>('thread-1');
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: threadId$.asObservable(),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{ type: 'values', values: { count: 1 } }]);
    await new Promise(r => setTimeout(r, 10));

    threadId$.next('thread-2');
    transport.emit([
      { type: 'values', values: { count: 99 } },
      { type: 'messages', messages: [{ id: 'late', type: 'human', content: 'stale' }] as any[] },
    ]);
    await new Promise(r => setTimeout(r, 10));

    expect(subjects.values$.value).toEqual({});
    expect(subjects.messages$.value).toEqual([]);
    destroy$.next();
  });

  it('aborts the active stream when threadId changes', async () => {
    const abortSignals: AbortSignal[] = [];
    const transport: AgentTransport = {
      async *stream(_assistantId, _threadId, _payload, signal) {
        abortSignals.push(signal);
        await new Promise<void>(resolve => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
        yield* [];
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const threadId$ = new BehaviorSubject<string | null>('thread-1');
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: threadId$.asObservable(),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    threadId$.next('thread-2');

    await new Promise(r => setTimeout(r, 10));

    expect(abortSignals).toHaveLength(1);
    expect(abortSignals[0].aborted).toBe(true);
    expect(subjects.values$.value).toEqual({});
    expect(subjects.messages$.value).toEqual([]);
    destroy$.next();
  });

  it('adopts a thread id created mid-stream by a custom transport instead of aborting the run', async () => {
    // A consumer-supplied transport creates the thread itself and reports the
    // id back through the configured thread-id signal while the first run is
    // still streaming. The bridge has no thread of its own yet, so this is an
    // adoption — it must NOT be mistaken for a thread switch and must not
    // abort the run that just started.
    const transport = new MockAgentTransport();
    const streamSpy = vi.spyOn(transport, 'stream');
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const threadId$ = new BehaviorSubject<string | null>(null);
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: threadId$.asObservable(),
      destroy$: destroy$.asObservable(),
    });

    const submitted = bridge.submit({});
    await new Promise(r => setTimeout(r, 10));

    threadId$.next('thread-created-by-transport');

    transport.emit([{ type: 'values', values: { count: 1 } }]);
    await new Promise(r => setTimeout(r, 10));

    const signal = streamSpy.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(false);
    expect(subjects.values$.value).toEqual({ count: 1 });
    expect(subjects.status$.value).not.toBe(ResourceStatus.Error);

    transport.close();
    await submitted;
    destroy$.next();
  });

  it('still aborts and resets when a known thread id switches to a different one mid-stream', async () => {
    const transport = new MockAgentTransport();
    const streamSpy = vi.spyOn(transport, 'stream');
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const threadId$ = new BehaviorSubject<string | null>('thread-1');
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: threadId$.asObservable(),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    await new Promise(r => setTimeout(r, 10));
    transport.emit([{ type: 'values', values: { count: 1 } }]);
    await new Promise(r => setTimeout(r, 10));
    expect(subjects.values$.value).toEqual({ count: 1 });

    threadId$.next('thread-2');
    await new Promise(r => setTimeout(r, 10));

    const signal = streamSpy.mock.calls[0][3] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(subjects.values$.value).toEqual({});
    expect(subjects.messages$.value).toEqual([]);
    destroy$.next();
  });

  it('stop() aborts the active stream and sets status to Idle (user-stop is not an error)', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    await bridge.stop();
    // User-initiated stop → Idle (not Resolved, not Error)
    expect(subjects.status$.value).toBe(ResourceStatus.Idle);
    // No error published
    expect(subjects.error$.value).toBeUndefined();
    destroy$.next();
  });

    it('classifies a non-user AbortError thrown BEFORE streaming as connection (kind:connection, retryable:true)', async () => {
    // Simulate an SDK that surfaces a connect-phase failure as an AbortError-like
    // error (name === 'AbortError') even though the user never called stop().
    // The bridge must NOT classify this as 'aborted' (user stop) — it must
    // classify it as 'connection' because streamingStarted is false.
    const connectFailure = new Error('Connection timed out');
    connectFailure.name = 'AbortError';

    const transport: AgentTransport = {
      async *stream() {
        yield* []; // required by require-yield; yields nothing, so streamingStarted stays false
        throw connectFailure; // throws before any event is processed
      },
    };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    await bridge.submit({});

    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    const err = subjects.error$.value;
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).kind).toBe('connection');
    expect((err as AgentError).retryable).toBe(true);
      destroy$.next();
    });

    it('isolates a replacement execution from buffered events emitted by the old stream', async () => {
      let releaseOld = () => undefined;
      let releaseNew = () => undefined;
      const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
      const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
      const transport: AgentTransport = {
        async *stream(_assistantId, _threadId, payload) {
          const run = (payload as { run: number }).run;
          if (run === 1) {
            await oldGate;
            yield {
              type: 'messages',
              messages: [{
                id: 'old-ai', type: 'ai', content: 'old',
                tool_calls: [{
                  id: 'old-call', name: 'task',
                  args: { subagent_type: 'researcher', description: 'old work' },
                }],
              }],
              messageMetadata: { langgraph_node: 'model' },
            };
            yield {
              type: 'values|tools:old-call', namespace: ['tools:old-call'],
              data: { messages: [{ type: 'human', content: 'old work' }] },
            };
            yield { type: 'error', error: new Error('old failure') };
            return;
          }

          yield {
            type: 'messages',
            messages: [{ id: 'new-ai', type: 'ai', content: 'new' }],
            messageMetadata: { langgraph_node: 'model' },
          };
          await newGate;
          yield { type: 'values', values: { done: true } };
        },
      };
      const subjects = makeSubjects();
      const destroy$ = new Subject<void>();
      const bridge = createStreamManagerBridge({
        options: {
          apiUrl: '', assistantId: 'test', transport,
          subagentToolNames: ['task'],
        },
        subjects,
        threadId$: of('thread-1'),
        destroy$: destroy$.asObservable(),
      });

      const first = bridge.submit({ run: 1 });
      await new Promise(resolve => setTimeout(resolve, 0));
      const second = bridge.submit({ run: 2 });
      await new Promise(resolve => setTimeout(resolve, 0));
      const newStreaming = bridge.getMessageDelivery('new-ai');

      releaseOld();
      expect(await first).toBe('interrupted');

      expect(subjects.messages$.value).toEqual([
        expect.objectContaining({ id: 'new-ai', content: 'new' }),
      ]);
      expect(bridge.getMessageDelivery('new-ai')).toEqual(newStreaming);
      expect(bridge.getMessageDelivery('old-ai')).toEqual({
        generation: 'old-ai', phase: 'complete', outcome: 'success',
      });
      expect(subjects.subagents$.value.size).toBe(0);
      expect(subjects.status$.value).toBe(ResourceStatus.Loading);
      expect(subjects.error$.value).toBeUndefined();

      releaseNew();
      await second;
      expect(bridge.getMessageDelivery('new-ai')).toEqual({
        generation: newStreaming.generation,
        phase: 'complete',
        outcome: 'success',
      });
      destroy$.next();
    });

    it('routes custom events to custom$ subject', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'custom',
      data: { name: 'state_update', data: { '/mrr/value': 42000 } },
    } as any]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.custom$.value).toHaveLength(1);
    expect(subjects.custom$.value[0]).toEqual({ name: 'state_update', data: { '/mrr/value': 42000 } });
    destroy$.next();
  });

  it('updates toolProgress$ from tools stream events', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([
      { type: 'tools', data: { event: 'on_tool_start', toolCallId: 'call-1', name: 'search', input: { q: 'angular' } } },
      { type: 'tools', data: { event: 'on_tool_event', toolCallId: 'call-1', name: 'search', data: { step: 1 } } },
      { type: 'tools', data: { event: 'on_tool_end', toolCallId: 'call-1', name: 'search', output: 'done' } },
    ] satisfies StreamEvent[]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.toolProgress$.value).toEqual([
      {
        toolCallId: 'call-1',
        name: 'search',
        state: 'completed',
        input: { q: 'angular' },
        data: { step: 1 },
        result: 'done',
      },
    ]);
    destroy$.next();
  });

  it('marks tool progress as error when a tool error event is received', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([
      { type: 'tools', data: { event: 'on_tool_start', toolCallId: 'call-1', name: 'search', input: { q: 'angular' } } },
      { type: 'tools', data: { event: 'on_tool_error', toolCallId: 'call-1', name: 'search', error: 'failed' } },
    ] satisfies StreamEvent[]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.toolProgress$.value).toEqual([
      {
        toolCallId: 'call-1',
        name: 'search',
        state: 'error',
        input: { q: 'angular' },
        error: 'failed',
      },
    ]);
    destroy$.next();
  });

  it('derives toolCalls$ from AI tool calls and matching tool messages', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [
        {
          id: 'ai-1',
          type: 'ai',
          content: '',
          tool_calls: [{ id: 'call-1', name: 'search', args: { q: 'angular' } }],
        },
        {
          id: 'tool-1',
          type: 'tool',
          tool_call_id: 'call-1',
          content: 'result',
          status: 'success',
        },
      ],
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.toolCalls$.value).toHaveLength(1);
    expect(subjects.toolCalls$.value[0]).toMatchObject({
      id: 'call-1',
      state: 'completed',
      call: { name: 'search', args: { q: 'angular' } },
      result: { content: 'result' },
    });
    destroy$.next();
  });

  it('stores message tuple metadata by message id', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-1', type: 'ai', content: 'hello' }],
      messageMetadata: { langgraph_node: 'model', run_id: 'run-1' },
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.messageMetadata$.value.get('ai-1')).toEqual({
      messageId: 'ai-1',
      firstSeenState: undefined,
      branch: undefined,
      branchOptions: undefined,
      streamMetadata: { langgraph_node: 'model', run_id: 'run-1' },
    });
    destroy$.next();
  });

  it('merges message tuple events into the existing transcript', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({ messages: [{ type: 'human', content: 'hello' }] });
    // Tuple/messages events with messageMetadata are declared deltas — each
    // chunk carries only its incremental slice of text, never the
    // message-so-far. 'hel' + 'lo' (not a resent 'hello') reflects real
    // wire behavior and merges into the same transcript entry by id.
    transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-1', type: 'ai', content: 'hel' }],
      messageMetadata: { langgraph_node: 'model' },
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-1', type: 'ai', content: 'lo' }],
      messageMetadata: { langgraph_node: 'model' },
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.messages$.value).toEqual([
      // Optimistic human is stamped with a stable id so chat-message-list
      // track-by-id keeps the same DOM across streaming re-emissions.
      expect.objectContaining({ type: 'human', content: 'hello', id: expect.stringMatching(/^optimistic-/) }),
      expect.objectContaining({ id: 'ai-1', type: 'ai', content: 'hello' }),
    ]);
    destroy$.next();
  });

  it('tracks configured subagent tool calls through running and completion states', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        subagentToolNames: ['task'],
      },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1',
        type: 'ai',
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'task',
          args: { subagent_type: 'researcher', description: 'Research Angular signals' },
        }],
      }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'values|tools:call-1' as StreamEvent['type'],
      namespace: ['tools:call-1'],
      data: { messages: [{ type: 'human', content: 'Research Angular signals' }], notes: 'started' },
    } satisfies StreamEvent]);

    await new Promise(r => setTimeout(r, 10));

    const running = subjects.subagents$.value.get('call-1');
    expect(running?.toolCallId).toBe('call-1');
    expect(running?.status()).toBe('running');
    expect(running?.values()).toMatchObject({ notes: 'started' });

    transport.emit([{
      type: 'messages',
      messages: [{ id: 'tool-1', type: 'tool', tool_call_id: 'call-1', content: 'done', status: 'success' }],
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.subagents$.value.get('call-1')?.status()).toBe('complete');
    destroy$.next();
  });

  it('routes tool-child message tuples to the child stream, never the transcript', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        subagentToolNames: ['task'],
      },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1',
        type: 'ai',
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'task',
          args: { subagent_type: 'researcher', description: 'Research Angular signals' },
        }],
      }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|tools:call-1' as StreamEvent['type'],
      namespace: ['tools:call-1'],
      messages: [{ id: 'sub-ai-1', type: 'ai', content: 'Subagent note' }],
      messageMetadata: { checkpoint_ns: 'tools:call-1|model:abc' },
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.messages$.value).toHaveLength(1);
    expect(subjects.messages$.value[0]).toMatchObject({ id: 'ai-1' });
    expect(subjects.subagents$.value.get('call-1')?.messages()).toEqual([
      expect.objectContaining({ id: 'sub-ai-1', type: 'ai', content: 'Subagent note' }),
    ]);
    destroy$.next();
  });

  it('replays child messages that streamed before the namespace was attributed', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    // Parent registers the delegation under the TOOL CALL id.
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'call_abc', name: 'task', args: { subagent_type: 'researcher', description: 'Research signals' } }],
      }],
    } satisfies StreamEvent]);

    // The child streams under an INTERNAL UUID namespace, not the tool-call id.
    // This is what LangGraph actually emits — verified on the wire.
    transport.emit([{
      type: 'messages|tools:aa5c61a1-e3ee-ea36' as StreamEvent['type'],
      namespace: ['tools:aa5c61a1-e3ee-ea36'],
      messages: [{ id: 'sub-1', type: 'ai', content: 'early chunk' }],
      messageMetadata: { checkpoint_ns: 'tools:aa5c61a1-e3ee-ea36|model' },
    } satisfies StreamEvent]);

    // The messages event above already attributed the namespace positionally
    // (ensureToolStreamAttribution, #847), so this values event finds the
    // mapping in place — the description ladder is short-circuited here. See
    // subagent-tracker.spec.ts for direct ladder coverage.
    transport.emit([{
      type: 'values|tools:aa5c61a1-e3ee-ea36' as StreamEvent['type'],
      namespace: ['tools:aa5c61a1-e3ee-ea36'],
      data: { messages: [{ type: 'human', content: 'Research signals' }] },
    } as StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    // The pre-attribution chunk must not be lost — this is what made every
    // subagent card render "0 message(s)".
    expect(subjects.subagents$.value.get('call_abc')?.messages()).toEqual([
      expect.objectContaining({ id: 'sub-1', content: 'early chunk' }),
    ]);
    destroy$.next();
  });

  it('accumulates a child\'s streamed delta chunks instead of keeping only the last', async () => {
    // Child graphs stream AIMessageChunk deltas — ~14 chars each, hundreds per
    // message (measured on the wire). Replacing by id keeps only the final
    // delta, which rendered an attributed card as an empty message.
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'call_x', name: 'task', args: { subagent_type: 'research', task_description: 'x' } }],
      }],
    } satisfies StreamEvent]);

    for (const part of ['LAX ', 'is a ', 'large hub']) {
      transport.emit([{
        type: 'messages|tools:ns-1' as StreamEvent['type'],
        namespace: ['tools:ns-1'],
        messages: [{ id: 'chunk-1', type: 'AIMessageChunk', content: part }],
        messageMetadata: { checkpoint_ns: 'tools:ns-1|model' },
      } satisfies StreamEvent]);
    }
    transport.close();
    await new Promise(r => setTimeout(r, 10));

    const msgs = subjects.subagents$.value.get('call_x')?.messages() ?? [];
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as unknown as { content: string }).content).toBe('LAX is a large hub');
    destroy$.next();
  });

  it('binding events attribute concurrent children exactly, even out of order', async () => {
    // The case #864 deliberately left unattributed: two children outstanding,
    // streams arriving in reverse dispatch order. With server-announced
    // bindings (threadplane-middleware announce_subagent) both resolve
    // deterministically — no guessing, no empty cards.
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects, threadId$: of(null), destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [
          { id: 'call_ALPHA', name: 'task', args: { subagent_type: 'alpha', task_description: 'a' } },
          { id: 'call_BETA',  name: 'task', args: { subagent_type: 'beta',  task_description: 'b' } },
        ],
      }],
    } satisfies StreamEvent]);
    // BETA's chunk arrives BEFORE any binding — it must buffer, not misroute.
    transport.emit([{
      type: 'messages|tools:ns-BETA' as StreamEvent['type'], namespace: ['tools:ns-BETA'],
      messages: [{ id: 'm-beta', type: 'AIMessageChunk', content: 'beta output' }],
      messageMetadata: { checkpoint_ns: 'tools:ns-BETA' },
    } satisfies StreamEvent]);
    // Bindings arrive (order irrelevant), exactly as announce_subagent emits them.
    transport.emit([{
      type: 'custom',
      data: { type: 'threadplane.subagent_binding', namespace: 'tools:ns-BETA', tool_call_id: 'call_BETA' },
    } as StreamEvent]);
    transport.emit([{
      type: 'custom',
      data: { type: 'threadplane.subagent_binding', namespace: 'tools:ns-ALPHA', tool_call_id: 'call_ALPHA' },
    } as StreamEvent]);
    transport.emit([{
      type: 'messages|tools:ns-ALPHA' as StreamEvent['type'], namespace: ['tools:ns-ALPHA'],
      messages: [{ id: 'm-alpha', type: 'AIMessageChunk', content: 'alpha output' }],
      messageMetadata: { checkpoint_ns: 'tools:ns-ALPHA' },
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));

    const txt = (x: unknown) => (x as { content?: string } | undefined)?.content;
    // Exact attribution both ways — including the pre-binding buffered chunk.
    expect(txt(subjects.subagents$.value.get('call_ALPHA')?.messages()[0])).toBe('alpha output');
    expect(txt(subjects.subagents$.value.get('call_BETA')?.messages()[0])).toBe('beta output');
    // Protocol chatter is consumed, not surfaced to customEvents().
    expect(subjects.custom$.value.filter(e =>
      typeof e.data === 'object' && e.data !== null
        && (e.data as Record<string, unknown>)['type'] === 'threadplane.subagent_binding',
    )).toHaveLength(0);
    destroy$.next();
  });

  it('a binding never overrides an established mapping', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects, threadId$: of(null), destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'call_X', name: 'task', args: { subagent_type: 'xray', task_description: 'x' } }],
      }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'custom',
      data: { type: 'threadplane.subagent_binding', namespace: 'tools:ns-X', tool_call_id: 'call_X' },
    } as StreamEvent]);
    // A duplicate binding for the same pair is a no-op, not a re-establish.
    transport.emit([{
      type: 'custom',
      data: { type: 'threadplane.subagent_binding', namespace: 'tools:ns-X', tool_call_id: 'call_X' },
    } as StreamEvent]);
    transport.emit([{
      type: 'messages|tools:ns-X' as StreamEvent['type'], namespace: ['tools:ns-X'],
      messages: [{ id: 'm-x', type: 'AIMessageChunk', content: 'x output' }],
      messageMetadata: { checkpoint_ns: 'tools:ns-X' },
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    const txt = (x: unknown) => (x as { content?: string } | undefined)?.content;
    expect(txt(subjects.subagents$.value.get('call_X')?.messages()[0])).toBe('x output');
    destroy$.next();
  });

  it('never cross-wires concurrent children when arrival order != dispatch order', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects, threadId$: of(null), destroy$: destroy$.asObservable(),
    });
    bridge.submit({});
    // Parent dispatches TWO children in one AI message: alpha then beta.
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [
          { id: 'call_ALPHA', name: 'task', args: { subagent_type: 'alpha', task_description: 'a' } },
          { id: 'call_BETA',  name: 'task', args: { subagent_type: 'beta',  task_description: 'b' } },
        ],
      }],
    } satisfies StreamEvent]);
    // BETA's child streams FIRST (parallel fan-out; arrival order != dispatch order).
    transport.emit([{
      type: 'messages|tools:ns-BETA' as StreamEvent['type'], namespace: ['tools:ns-BETA'],
      messages: [{ id: 'm-beta', type: 'AIMessageChunk', content: 'beta output' }],
      messageMetadata: { checkpoint_ns: 'tools:ns-BETA' },
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|tools:ns-ALPHA' as StreamEvent['type'], namespace: ['tools:ns-ALPHA'],
      messages: [{ id: 'm-alpha', type: 'AIMessageChunk', content: 'alpha output' }],
      messageMetadata: { checkpoint_ns: 'tools:ns-ALPHA' },
    } satisfies StreamEvent]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    const alpha = subjects.subagents$.value.get('call_ALPHA');
    const beta  = subjects.subagents$.value.get('call_BETA');
    // Two children are outstanding at once and the namespaces carry no link to
    // the tool-call ids, so neither stream can be attributed honestly. The old
    // fallback claimed the first unmapped call and handed alpha's card beta's
    // output. Refusing to guess is the correct outcome: an empty card, never a
    // confidently wrong one.
    const txt = (x: unknown) => (x as { content?: string } | undefined)?.content;
    expect(txt(alpha?.messages()[0])).not.toBe('beta output');
    expect(txt(beta?.messages()[0])).not.toBe('alpha output');
    destroy$.next();
  });

  it('attributes a tool child whose values carry no human first message', async () => {
    // The real shape emitted by cockpit/chat/subagents, captured off the wire:
    // the delegation tool takes `task_description` (not `description`), and the
    // child's values.messages[0] is an AI message, never a human one. Both
    // description rungs of the ladder are therefore unreachable, so attribution
    // has to fall back to the unmapped pending/running child.
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'call_kd4Q', name: 'task', args: { subagent_type: 'research', task_description: 'Airport details' } }],
      }],
    } satisfies StreamEvent]);

    // Child streams under an internal UUID namespace.
    transport.emit([{
      type: 'messages|tools:f61899a8-459d' as StreamEvent['type'],
      namespace: ['tools:f61899a8-459d'],
      messages: [{ id: 'sub-1', type: 'ai', content: 'LAX is a large hub' }],
      messageMetadata: { checkpoint_ns: 'tools:f61899a8-459d|model' },
    } satisfies StreamEvent]);

    // Its values carry an AI first message — no human anywhere.
    transport.emit([{
      type: 'values|tools:f61899a8-459d' as StreamEvent['type'],
      namespace: ['tools:f61899a8-459d'],
      data: { messages: [{ type: 'ai', content: 'LAX is a large hub' }] },
    } as StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    // This is what the "0 message(s)" card bug looked like: status settled but
    // the child's transcript never arrived.
    expect(subjects.subagents$.value.get('call_kd4Q')?.messages()).toEqual([
      expect.objectContaining({ id: 'sub-1', content: 'LAX is a large hub' }),
    ]);
    destroy$.next();
  });

  it('routes plain-subgraph message tuples to a namespace-keyed child stream, never the transcript', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{ id: 'parent-ai', type: 'ai', content: 'routing' }],
      messageMetadata: { langgraph_node: 'orchestrate' },
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'messages|research:abc123' as StreamEvent['type'],
      namespace: ['research:abc123'],
      messages: [{ id: 'child-ai', type: 'ai', content: 'internal brief' }],
      messageMetadata: { checkpoint_ns: 'research:abc123', langgraph_node: 'research' },
    } satisfies StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    // Transcript: parent only. The child's tokens never merge.
    expect(subjects.messages$.value).toHaveLength(1);
    expect(subjects.messages$.value[0]).toMatchObject({ id: 'parent-ai' });

    // Child stream: keyed by the namespace segment, named by its node prefix.
    const child = subjects.subagents$.value.get('research:abc123');
    expect(child).toBeDefined();
    expect(child?.name).toBe('research');
    expect(child?.messages()).toEqual([
      expect.objectContaining({ id: 'child-ai', content: 'internal brief' }),
    ]);
    destroy$.next();
  });

  it("keeps a plain child's values and updates out of the parent's values$", async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([
      { type: 'values', data: { messages: [], research_topic: 'checkpointing' } },
      {
        type: 'values|research:abc123' as StreamEvent['type'],
        namespace: ['research:abc123'],
        data: { research_brief: 'child-only state' },
      },
      {
        type: 'updates|research:abc123' as StreamEvent['type'],
        namespace: ['research:abc123'],
        data: { research: { research_brief: 'child-only state' } },
      },
    ] as StreamEvent[]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    // Parent values$ holds only what the parent emitted at top level — a
    // child's values event must neither replace nor spread-merge into it.
    expect(subjects.values$.value).toEqual({ messages: [], research_topic: 'checkpointing' });
    // The child's state landed on its own stream.
    expect(subjects.subagents$.value.get('research:abc123')?.values()).toMatchObject({
      research_brief: 'child-only state',
    });
    destroy$.next();
  });

  it('settles running subgraph children when the run completes, but not on pause', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    const done = bridge.submit({});
    await transport.emit([{
      type: 'messages|research:abc123' as StreamEvent['type'],
      namespace: ['research:abc123'],
      messages: [{ id: 'child-ai', type: 'ai', content: 'brief' }],
      messageMetadata: { checkpoint_ns: 'research:abc123' },
    } satisfies StreamEvent]);
    expect(subjects.subagents$.value.get('research:abc123')?.status()).toBe('running');

    transport.emit([{ type: 'values', data: { done: true } } as StreamEvent]);
    transport.close();
    await done;

    expect(subjects.subagents$.value.get('research:abc123')?.status()).toBe('complete');
    destroy$.next();
  });

  it('never attributes a plain child to a pending tool subagent via the fallback ladder', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    // A pending tool child exists…
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1', type: 'ai', content: '',
        tool_calls: [{ id: 'call-1', name: 'task', args: { subagent_type: 'researcher', description: 'tool work' } }],
      }],
    } satisfies StreamEvent]);
    // …and a plain subgraph child streams values with a human first message —
    // the shape the description ladder keys on.
    transport.emit([{
      type: 'values|research:abc123' as StreamEvent['type'],
      namespace: ['research:abc123'],
      data: { messages: [{ type: 'human', content: 'unrelated child input' }] },
    } as StreamEvent]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    // The plain child is its own entry; the tool child absorbed nothing.
    expect(subjects.subagents$.value.get('research:abc123')?.name).toBe('research');
    // Before the ladder was scoped to tool children, the fallback would have
    // mapped the namespace onto call-1 and flipped it to 'running', making it
    // visible. It must remain pending — and pending entries stay hidden.
    expect(subjects.subagents$.value.get('call-1')).toBeUndefined();
    destroy$.next();
  });

  it('clears tracked subagents when the thread changes', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const threadId$ = new BehaviorSubject<string | null>('thread-1');
    const bridge = createStreamManagerBridge({
      options: {
        apiUrl: '',
        assistantId: 'test',
        transport,
        subagentToolNames: ['task'],
      },
      subjects,
      threadId$: threadId$.asObservable(),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'messages',
      messages: [{
        id: 'ai-1',
        type: 'ai',
        content: '',
        tool_calls: [{
          id: 'call-1',
          name: 'task',
          args: { subagent_type: 'researcher', description: 'Research Angular signals' },
        }],
      }],
    } satisfies StreamEvent]);
    transport.emit([{
      type: 'values|tools:call-1' as StreamEvent['type'],
      namespace: ['tools:call-1'],
      data: { messages: [{ type: 'human', content: 'Research Angular signals' }] },
    } satisfies StreamEvent]);
    await new Promise(r => setTimeout(r, 10));
    expect(subjects.subagents$.value.size).toBe(1);

    threadId$.next('thread-2');
    await new Promise(r => setTimeout(r, 10));

    expect(subjects.subagents$.value.size).toBe(0);
    destroy$.next();
  });

  it('accumulates multiple custom events in order', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    bridge.submit({});
    transport.emit([{
      type: 'custom',
      data: { name: 'state_update', data: { '/mrr/value': 42000 } },
    } as any]);
    transport.emit([{
      type: 'custom',
      data: { name: 'progress', data: { step: 2 } },
    } as any]);
    transport.close();

    await new Promise(r => setTimeout(r, 10));

    expect(subjects.custom$.value).toHaveLength(2);
    expect(subjects.custom$.value[0]).toEqual({ name: 'state_update', data: { '/mrr/value': 42000 } });
    expect(subjects.custom$.value[1]).toEqual({ name: 'progress', data: { step: 2 } });
    destroy$.next();
  });

  it('clears custom$ on a new submit', async () => {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });

    // First submit with a custom event
    bridge.submit({});
    transport.emit([{
      type: 'custom',
      data: { name: 'state_update', data: { '/mrr/value': 42000 } },
    } as any]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));

    expect(subjects.custom$.value).toHaveLength(1);

    // Second submit — custom$ should reset to []
    const transport2 = new MockAgentTransport();
    // Replace internal transport by re-creating the bridge with the same subjects
    const destroy2$ = new Subject<void>();
    const bridge2 = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport: transport2 },
      subjects,
      threadId$: of(null),
      destroy$: destroy2$.asObservable(),
    });
    bridge2.submit({});
    await new Promise(r => setTimeout(r, 10));

    expect(subjects.custom$.value).toHaveLength(0);

    transport2.close();
    await new Promise(r => setTimeout(r, 10));
    destroy$.next();
    destroy2$.next();
  });
});

import { _internalsForTesting } from './stream-manager.bridge';

describe('stream-manager.bridge — reasoning extraction', () => {
  const { extractReasoning, accumulateReasoning } = _internalsForTesting;

  it('extractReasoning returns "" for plain text content', () => {
    expect(extractReasoning('hello')).toBe('');
    expect(extractReasoning([{ type: 'text', text: 'hi' }])).toBe('');
  });

  it('extractReasoning concatenates {type:"reasoning"} block text', () => {
    expect(extractReasoning([
      { type: 'reasoning', text: 'first I ' },
      { type: 'reasoning', text: 'then ' },
    ])).toBe('first I then ');
  });

  it('extractReasoning treats {type:"thinking"} the same as reasoning', () => {
    expect(extractReasoning([
      { type: 'thinking', text: 'Anthropic-shape ' },
      { type: 'reasoning', text: 'OpenAI-shape' },
    ])).toBe('Anthropic-shape OpenAI-shape');
  });

  it('extractReasoning skips text/output_text/tool_use/image blocks', () => {
    expect(extractReasoning([
      { type: 'text', text: 'visible' },
      { type: 'reasoning', text: 'hidden' },
      { type: 'tool_use', id: 'a', name: 'foo', args: {} },
      { type: 'image', url: '…' },
    ])).toBe('hidden');
  });

  it('extractReasoning pulls text from OpenAI Responses API summary items', () => {
    const content = [
      {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: 'First thought. ' },
          { type: 'summary_text', text: 'Second thought.' },
        ],
      },
      { type: 'text', text: 'Visible answer' },
    ];
    expect(extractReasoning(content)).toBe('First thought. Second thought.');
  });

  it('extractReasoning ignores summary items missing text', () => {
    const content = [
      {
        type: 'reasoning',
        summary: [
          { type: 'summary_text', text: 'Kept. ' },
          { type: 'summary_text' },
          null,
          { text: 'Also kept.' },
        ],
      },
    ];
    expect(extractReasoning(content)).toBe('Kept. Also kept.');
  });

  it('accumulateReasoning returns "" for two empty inputs', () => {
    expect(accumulateReasoning(undefined, undefined)).toBe('');
    expect(accumulateReasoning('', '')).toBe('');
  });

  it('accumulateReasoning takes incoming when existing is empty', () => {
    expect(accumulateReasoning('', 'first chunk')).toBe('first chunk');
  });

  it('accumulateReasoning prefers strict superset (final-id swap)', () => {
    expect(accumulateReasoning('partial', 'partial-and-more')).toBe('partial-and-more');
  });

  it('accumulateReasoning keeps existing when it is the strict superset', () => {
    expect(accumulateReasoning('partial-and-more', 'partial')).toBe('partial-and-more');
  });

  it('accumulateReasoning appends pure deltas', () => {
    expect(accumulateReasoning('first ', 'second')).toBe('first second');
  });
});

describe('stream-manager.bridge — accumulateContent', () => {
  const { accumulateContent, isFinalCanonicalReasoningContent } = _internalsForTesting;

  it('returns incoming when existing is empty', () => {
    expect(accumulateContent('', 'hello')).toBe('hello');
    expect(accumulateContent(undefined, 'hello')).toBe('hello');
  });

  it('appends sequential string deltas (the legitimate delta path)', () => {
    expect(accumulateContent('hello', 'world')).toBe('helloworld');
  });

  it('replaces partial accumulator when final canonical reasoning+text array arrives', () => {
    const existing = 'partial answer';
    const incoming = [
      { type: 'reasoning', summary: [{ type: 'summary_text', text: 'I thought about it.' }] },
      { type: 'text', text: 'CANONICAL ANSWER' },
    ];
    expect(accumulateContent(existing, incoming)).toBe('CANONICAL ANSWER');
    expect(isFinalCanonicalReasoningContent(incoming)).toBe(true);
  });

  it('takes incoming when it is a strict superset of existing', () => {
    expect(accumulateContent('Step 1', 'Step 1: define')).toBe('Step 1: define');
  });
});

describe('stream-manager.bridge — mergeMessages', () => {
  const { mergeMessages } = _internalsForTesting;

  function aiMessage(opts: { id?: string; content: unknown }): unknown {
    return { type: 'ai', id: opts.id, content: opts.content, _getType: () => 'ai' };
  }

  it('accumulates same-id chunks into a single AI message', () => {
    const c1 = aiMessage({ id: 'run-1', content: 'Hello' });
    const c2 = aiMessage({ id: 'run-1', content: 'Hello world' });
    const merged = mergeMessages([] as never, [c1] as never);
    const merged2 = mergeMessages(merged, [c2] as never);
    expect(merged2.length).toBe(1);
    expect((merged2[0] as { content?: unknown }).content).toBe('Hello world');
  });

  it('chunk without id falls into the trailing AI message', () => {
    const initial = aiMessage({ id: 'run-1', content: 'Hello' });
    const chunk = aiMessage({ content: ' world' });
    const merged = mergeMessages([initial] as never, [chunk] as never);
    expect(merged.length).toBe(1);
    expect((merged[0] as { content?: unknown }).content).toBe('Hello world');
  });

  it('reasoning+text content array sets next.reasoning AND replaces partial content', () => {
    const initial = aiMessage({ id: 'run-1', content: 'partial' });
    const finalCanonical = aiMessage({
      id: 'run-1',
      content: [
        { type: 'reasoning', summary: [{ type: 'summary_text', text: 'thinking…' }] },
        { type: 'text', text: 'final answer' },
      ],
    });
    const merged = mergeMessages([initial] as never, [finalCanonical] as never);
    expect(merged.length).toBe(1);
    const r = merged[0] as { content?: unknown; reasoning?: unknown };
    expect(r.content).toBe('final answer');
    expect(r.reasoning).toBe('thinking…');
  });
});

describe('stream-manager.bridge — collapseAdjacentAi', () => {
  const { collapseAdjacentAi } = _internalsForTesting;

  function aiMessage(opts: { id?: string; content: unknown }): unknown {
    return { type: 'ai', id: opts.id, content: opts.content, _getType: () => 'ai' };
  }

  it('collapses two adjacent AI messages with identical text into one', () => {
    const a = aiMessage({ id: 'a', content: 'hello world' });
    const b = aiMessage({ id: 'b', content: 'hello world' });
    const out = collapseAdjacentAi([a, b] as never);
    expect(out.length).toBe(1);
    expect((out[0] as { content?: unknown }).content).toBe('hello world');
  });

  it('keeps two adjacent AI messages with non-prefix-related text', () => {
    const a = aiMessage({ id: 'a', content: 'hello' });
    const b = aiMessage({ id: 'b', content: 'goodbye' });
    const out = collapseAdjacentAi([a, b] as never);
    expect(out.length).toBe(2);
  });
});

describe('stream-manager.bridge — captured streaming replay (Finding C)', () => {
  const { mergeMessages, extractText, normalizeMessageType } = _internalsForTesting;

  it('replaying captured chunks does not duplicate visible answer text', () => {
    let merged: unknown[] = [];
    for (const ev of FIXTURE.events) {
      if (ev.event === 'messages') {
        const tuples = ev.data as unknown[];
        const incoming = tuples
          .map(t => (Array.isArray(t) ? t[0] : t))
          .filter(m => m != null && typeof (m as Record<string, unknown>)['type'] === 'string') as unknown[];
        if (incoming.length === 0) continue;
        merged = mergeMessages(merged as never, incoming as never) as unknown[];
      } else if (ev.event === 'values') {
        // Mirror what the bridge does: also merge state.messages from values events.
        const stateMessages = ((ev.data as Record<string, unknown>)['messages'] ?? []) as unknown[];
        const incoming = stateMessages.filter(
          m => m != null && typeof (m as Record<string, unknown>)['type'] === 'string',
        ) as unknown[];
        if (incoming.length === 0) continue;
        merged = mergeMessages(merged as never, incoming as never) as unknown[];
      }
    }

    const lastAi = (merged as Array<{ type?: string; content?: unknown }>)
      .filter(m => normalizeMessageType(m.type) === 'ai')
      .pop();
    expect(lastAi).toBeTruthy();

    const visible = extractText(lastAi!.content);
    const expected = FIXTURE.canonical_text_length;
    expect(visible.length).toBeGreaterThanOrEqual(expected - 20);
    expect(visible.length).toBeLessThanOrEqual(expected + 20);
  });
});

describe('identity-based delta merge (messages-tuple)', () => {
  const META = { langgraph_node: 'chatbot' };

  function setup(extraOptions: Record<string, unknown> = {}) {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport, ...extraOptions },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    return { transport, subjects, destroy$, bridge };
  }

  function tupleEvent(id: string, content: unknown) {
    return {
      type: 'messages',
      data: [{ id, type: 'ai', content }, META],
      messageMetadata: META,
    } as any;
  }

  function lastAiContent(subjects: ReturnType<typeof makeSubjects>): string {
    // Select the last AI message specifically (not just the last array
    // entry): mergeMessages/preserveIds do not guarantee human messages
    // sort before AI messages once a values-sync event appends an
    // out-of-order human entry after an already-accumulating AI entry.
    const msgs = subjects.messages$.value as Array<{ type?: string; content?: unknown }>;
    const lastAi = [...msgs].reverse().find(m => m?.type === 'ai');
    return typeof lastAi?.content === 'string' ? lastAi.content : JSON.stringify(lastAi?.content);
  }

  it('preserves every delta chunk, including ones that prefix the message (table pipes)', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    const deltas = ['|', ' Gem', ' |', ' Color', ' |', '\n', '|', '---', '|', '---', '|', '\n', '|', ' Ruby', ' |', ' red', ' |'];
    for (const d of deltas) transport.emit([tupleEvent('ai-1', d)]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe(deltas.join(''));
    destroy$.next();
  });

  it('appends a multi-char delta that begins with the accumulated text', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    transport.emit([tupleEvent('ai-1', '|')]);
    transport.emit([tupleEvent('ai-1', '| Gem')]); // delta, NOT a superset echo
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('|| Gem');
    destroy$.next();
  });

  it('final canonical reasoning+text array replaces the accumulation and blocks late deltas', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    transport.emit([tupleEvent('ai-1', '| a |')]);
    transport.emit([tupleEvent('ai-1', ' | b |')]);
    transport.emit([tupleEvent('ai-1', [
      { type: 'reasoning', text: 'thought' },
      { type: 'text', text: '| a | | b | done' },
    ])]);
    transport.emit([tupleEvent('ai-1', '|')]); // straggler after canonical — must be ignored
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('| a | | b | done');
    destroy$.next();
  });

  it('a new run resets canonical marking (fresh-id deltas accumulate again)', async () => {
    // NOTE: MockAgentTransport.closed is permanent once close() is called —
    // its stream() generator checks `!this.closed` on every fresh invocation,
    // so a second submit() through the SAME instance would fall straight
    // through to an immediate drain-and-return, never seeing events emitted
    // after the second submit. Use a second transport/bridge instance for the
    // second run, same pattern as the existing 'clears custom$ on a new
    // submit' test above, which shares `subjects` but not the transport.
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    transport.emit([tupleEvent('ai-1', [
      { type: 'reasoning', text: 'r' },
      { type: 'text', text: 'final one' },
    ])]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));

    const transport2 = new MockAgentTransport();
    const destroy2$ = new Subject<void>();
    const bridge2 = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport: transport2 },
      subjects,
      threadId$: of(null),
      destroy$: destroy2$.asObservable(),
    });
    // Real "new run" submits carry a human message, which runStream()
    // optimistically injects into messages$ before streaming starts. That
    // human message is what gives mergeMessages' trailing-AI fallback a
    // boundary to stop at (see mergeMessages: it walks backward from the
    // tail and stops at the first human/tool/system message) — without it,
    // a fresh id with no content overlap would keep accumulating onto the
    // previous run's AI slot since nothing marks the run boundary.
    bridge2.submit({ messages: [{ type: 'human', content: 'second question' }] });
    transport2.emit([tupleEvent('ai-2', 'fresh')]);
    transport2.emit([tupleEvent('ai-2', ' text')]);
    transport2.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('fresh text');
    destroy$.next();
    destroy2$.next();
  });

  it('messages/partial snapshots still reconcile by prefix (regression)', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    const partial = (content: string) => ({
      type: 'messages/partial',
      data: [{ id: 'ai-1', type: 'ai', content }],
    } as any);
    transport.emit([partial('| Gem')]);
    transport.emit([partial('| Gem | Color |')]); // superset → replace
    transport.emit([partial('| Gem')]);            // stale shorter snapshot → keep longer
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('| Gem | Color |');
    destroy$.next();
  });

  it('ignores message tuple chunks from non-transcript nodes when configured', async () => {
    const { transport, subjects, destroy$, bridge } = setup({
      transcriptNodeNames: ['chatbot'],
    });
    bridge.submit({});
    transport.emit([
      tupleEvent('ai-1', 'Here is the answer.'),
      {
        type: 'messages',
        data: [
          { id: 'title-1', type: 'ai', content: 'This title must not render.' },
          { langgraph_node: 'generate_title' },
        ],
        messageMetadata: { langgraph_node: 'generate_title' },
      } as any,
    ]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('Here is the answer.');
    destroy$.next();
  });

  it('values-sync mid-run keeps snapshot semantics (lagging state does not rewind)', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    bridge.submit({});
    transport.emit([tupleEvent('ai-1', '| a | b |')]);
    transport.emit([tupleEvent('ai-1', ' | c |')]);
    transport.emit([{
      type: 'values',
      data: { messages: [
        { id: 'h-1', type: 'human', content: 'hi' },
        { id: 'ai-1', type: 'ai', content: '| a | b |' },
      ] },
    } as any]);
    transport.close();
    await new Promise(r => setTimeout(r, 10));
    expect(lastAiContent(subjects)).toBe('| a | b | | c |');
    destroy$.next();
  });
});

describe('what counts as evidence a turn completed', () => {
  function setup() {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of(null),
      destroy$: destroy$.asObservable(),
    });
    return { transport, subjects, destroy$, bridge };
  }

  function assistantMessages(subjects: StreamSubjects<Record<string, unknown>>) {
    return subjects.messages$.value.filter(
      message => (message as unknown as Record<string, unknown>)['type'] === 'ai',
    );
  }

  const chunk = {
    type: 'messages',
    messages: [{ id: 'ai-1', type: 'ai', content: 'partial' }],
    messageMetadata: { langgraph_node: 'model' },
  } as StreamEvent;

  it('reports a stream that emitted nothing at all as interrupted', async () => {
    const { transport, destroy$, bridge } = setup();
    const submitted = bridge.submit({});
    transport.close();
    expect(await submitted).toBe('interrupted');
    destroy$.next();
  });

  it('reports a stream that emitted a partial chunk and closed as interrupted', async () => {
    const { transport, destroy$, bridge } = setup();
    const submitted = bridge.submit({});
    transport.emit([chunk]);
    transport.close();
    expect(await submitted).toBe('interrupted');
    expect(bridge.getMessageDelivery('ai-1')).toMatchObject({
      phase: 'complete',
      outcome: 'interrupted',
    });
    destroy$.next();
  });

  it('accepts a payloadless root terminal event after a chunk as a success', async () => {
    const { transport, destroy$, bridge } = setup();
    const submitted = bridge.submit({});
    // Once the step has spoken, any root terminal marker settles it — the
    // marker need carry no payload. This is the sole domain of
    // currentStepHasTerminalEvidence: a null-payload event never sets
    // rootTerminalEvidence, so the other clause cannot cover this case.
    transport.emit([chunk, { type: 'values', data: null } as StreamEvent]);
    transport.close();
    expect(await submitted).toBe('success');
    destroy$.next();
  });

  it('reports a state-only turn that never spoke as success', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    const submitted = bridge.submit({});
    // A graph turn may carry the whole of its work in state and never emit an
    // assistant message. The payload-bearing snapshot is its completion
    // signal, and no later chunk arrives to invalidate it.
    transport.emit([{ type: 'values', data: { itinerary: { updated: true } } } as StreamEvent]);
    transport.close();
    expect(await submitted).toBe('success');
    expect(assistantMessages(subjects)).toEqual([]);
    destroy$.next();
  });

  it('reports a turn that spoke and then snapshotted as a success', async () => {
    const { transport, destroy$, bridge } = setup();
    const submitted = bridge.submit({});
    transport.emit([chunk, { type: 'values', data: { answer: 'done' } } as StreamEvent]);
    transport.close();
    expect(await submitted).toBe('success');
    expect(bridge.getMessageDelivery('ai-1')).toMatchObject({
      phase: 'complete',
      outcome: 'success',
    });
    destroy$.next();
  });
});

describe('settling a closed stream from the refreshed history', () => {
  function setup() {
    const transport = new MockAgentTransport();
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });
    return { transport, subjects, destroy$, bridge };
  }

  /** Let the constructor-time (unforced) history refresh land before a test acts. */
  function settled(): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0));
  }

  function stateWithMessages(messages: unknown[]): ThreadState<Record<string, unknown>> {
    return { ...makeThreadState('cp-after'), values: { messages } as never };
  }

  function stateWithInterrupt(): ThreadState<Record<string, unknown>> {
    return {
      ...makeThreadState('cp-paused'),
      tasks: [{ id: 't1', name: 'ask', path: [], error: null, interrupts: [{ value: { question: 'ok?' } }], checkpoint: null, state: null, result: null }] as never,
    };
  }

  it('stays interrupted, and says so, when the refresh shows nothing new', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();

    const submitted = bridge.submit({});
    await transport.close();

    expect(await submitted).toBe('interrupted');
    const error = subjects.error$.value as AgentError | undefined;
    expect(error).toBeInstanceOf(AgentError);
    expect(error?.kind).toBe('interrupted');
    expect(error?.recovery).toBe('check');
    expect(error?.retryable).toBe(false);
    expect(error?.detail).toBeTruthy();
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    destroy$.next();
  });

  it('settles as a success when the refresh shows the turn committed server-side', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    transport.history = [stateWithMessages([{ id: 'ai-late', type: 'ai', content: 'finished anyway' }])];

    const submitted = bridge.submit({});
    await transport.close();

    expect(await submitted).toBe('success');
    expect(subjects.error$.value).toBeUndefined();
    expect(subjects.status$.value).toBe(ResourceStatus.Resolved);
    destroy$.next();
  });

  it('settles as paused when the refresh carries a pending interrupt', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    transport.history = [stateWithInterrupt()];

    const submitted = bridge.submit({});
    await transport.close();

    expect(await submitted).toBe('success');
    expect(subjects.interrupt$.value).toBeDefined();
    expect(subjects.error$.value).toBeUndefined();
    destroy$.next();
  });

  it('stays interrupted, without crashing, when the refresh itself fails', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    transport.getHistory = async () => { throw new Error('history unreachable'); };

    const submitted = bridge.submit({});
    await transport.close();

    expect(await submitted).toBe('interrupted');
    const error = subjects.error$.value as AgentError | undefined;
    expect(error?.kind).toBe('interrupted');
    expect(error?.recovery).toBe('check');
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    destroy$.next();
  });

  it('applies the same rule to a directly joined run', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    transport.joinStream = async function* () { yield* []; };

    await bridge.joinStream('run-1');

    expect((subjects.error$.value as AgentError | undefined)?.recovery).toBe('check');
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    destroy$.next();
  });

  it('applies the same rule to a queue-drained run', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    transport.joinStream = async function* () { yield* []; };

    const active = bridge.submit({ active: true });
    await bridge.submit({ queued: true }, { multitaskStrategy: 'enqueue' });
    transport.emit([{ type: 'values', data: { active: true } } as StreamEvent]);
    await transport.close();
    await active;

    expect((subjects.error$.value as AgentError | undefined)?.recovery).toBe('check');
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    destroy$.next();
  });

  it('discards a history answer that arrives after a newer request started', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();

    let release!: (history: ThreadState[]) => void;
    transport.getHistory = () => new Promise<ThreadState[]>(resolve => { release = resolve; });

    // A first, interrupted run leaves an error offering the check. Its own
    // close-time refresh is the held one; answer it with "nothing new".
    const first = bridge.submit({});
    await transport.close();
    await settled();
    release([]);
    await first;
    expect((subjects.error$.value as AgentError | undefined)?.recovery).toBe('check');

    // Now hold the check's refresh open. Only the check's own read is held —
    // the newer run must be free to finish and do its own refresh.
    const held = new Promise<ThreadState[]>(resolve => { release = resolve; });
    let served = false;
    transport.getHistory = async () => {
      if (served) return [];
      served = true;
      return held;
    };
    const checking = bridge.checkStatus?.();

    // A newer run starts and the stale answer lands while it is still
    // streaming. (A gated generator, because MockAgentTransport's own stream
    // stays closed once closed.)
    let finishSecond!: () => void;
    const gate = new Promise<void>(resolve => { finishSecond = resolve; });
    // The snapshot goes first so the newer run has already cleared interrupt$
    // by the time the stale answer lands: nothing but the staleness guard can
    // then account for the interrupt's absence at the end.
    transport.stream = async function* () {
      yield { type: 'values', data: { done: true } } as StreamEvent;
      await gate;
    };
    const second = bridge.submit({});
    await settled();
    expect(subjects.interrupt$.value).toBeUndefined();
    release([stateWithInterrupt()]);
    await checking;

    finishSecond();
    expect(await second).toBe('success');

    // The stale checkpoint's interrupt must not have been hydrated: interrupt
    // hydration is additive, so nothing else would have undone it.
    expect(subjects.interrupt$.value).toBeUndefined();
    destroy$.next();
  });

  it('refuses a status check while a request is in flight', async () => {
    const { transport, destroy$, bridge } = setup();
    await settled();
    const run = bridge.submit({});
    await expect(bridge.checkStatus?.()).rejects.toThrow();
    await transport.close();
    await run;
    destroy$.next();
  });

  it('clears the interrupted error when a later check finds the run finished', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();

    const submitted = bridge.submit({});
    await transport.close();
    expect(await submitted).toBe('interrupted');
    expect(subjects.error$.value).toBeDefined();

    transport.history = [stateWithMessages([{ id: 'ai-late', type: 'ai', content: 'finished anyway' }])];
    await bridge.checkStatus?.();

    expect(subjects.error$.value).toBeUndefined();
    expect(subjects.status$.value).toBe(ResourceStatus.Idle);
    destroy$.next();
  });

  it('leaves the error in place when a check comes back inconclusive', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();

    const submitted = bridge.submit({});
    await transport.close();
    expect(await submitted).toBe('interrupted');

    // The server still reports nothing beyond what was already here, so the
    // outcome is no more certain than before. The check must be offerable again.
    await bridge.checkStatus?.();

    expect((subjects.error$.value as AgentError | undefined)?.recovery).toBe('check');
    expect(subjects.status$.value).toBe(ResourceStatus.Error);
    destroy$.next();
  });

  it('cannot offer Retry after a dispatched request lost its stream', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    // A non-user abort AFTER the server began answering. The request reached
    // the server and may already have run a tool, so a Retry button here
    // invites the duplicate this whole feature exists to prevent.
    transport.stream = async function* () {
      yield {
        type: 'messages',
        messages: [{ id: 'ai-1', type: 'ai', content: 'partial' }],
        messageMetadata: { langgraph_node: 'model' },
      } as StreamEvent;
      const abort = new Error('connection reset');
      abort.name = 'AbortError';
      throw abort;
    };

    await bridge.submit({});

    const error = subjects.error$.value as AgentError | undefined;
    expect(error?.kind).toBe('interrupted');
    expect(error?.retryable).toBe(false);
    expect(error?.recovery).toBe('check');
    expect(error?.message).toBe(AGENT_RECOVERY_MESSAGES.check);
    expect(error?.detail).toBe(AGENT_RECOVERY_DETAILS.check);
    destroy$.next();
  });

  it('still offers Retry when the abort happened before anything was dispatched', async () => {
    const { transport, subjects, destroy$, bridge } = setup();
    await settled();
    // Nothing streamed, so nothing reached the server to be duplicated.
    transport.stream = async function* () {
      if (transport) {
        const abort = new Error('connection reset');
        abort.name = 'AbortError';
        throw abort;
      }
      yield* [];
    };

    await bridge.submit({});

    const error = subjects.error$.value as AgentError | undefined;
    expect(error?.kind).toBe('connection');
    expect(error?.retryable).toBe(true);
    expect(error?.recovery).toBeUndefined();
    destroy$.next();
  });

  it('offers no check, and no check control, without a history-reading transport', async () => {
    const transport: AgentTransport = { async *stream() { yield* []; } };
    const subjects = makeSubjects();
    const destroy$ = new Subject<void>();
    const bridge = createStreamManagerBridge({
      options: { apiUrl: '', assistantId: 'test', transport },
      subjects,
      threadId$: of('thread-1'),
      destroy$: destroy$.asObservable(),
    });

    expect(await bridge.submit({})).toBe('interrupted');
    expect((subjects.error$.value as AgentError | undefined)?.recovery).toBe('none');
    expect(bridge.checkStatus).toBeUndefined();
    destroy$.next();
  });
});
