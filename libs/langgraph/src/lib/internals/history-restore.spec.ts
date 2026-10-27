// Restoring subagent cards and reasoning when a thread is reloaded.
//
// Live, subagent cards are fed by child-namespace stream events and reasoning
// by the streamed merge; neither replays on reload. These specs drive the
// bridge from a persisted thread history alone (the fixture is the shape the
// threads history API returns) and assert what a reloaded thread shows.
import { describe, it, expect } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { BaseMessage } from '@langchain/core/messages';
import { createStreamManagerBridge } from './stream-manager.bridge';
import { mapChildExecutionsFromHistory, restoreReasoning } from './history-restore';
import { MockAgentTransport } from '../transport/mock-stream.transport';
import { ResourceStatus, type CustomStreamEvent, type StreamEvent, type StreamSubjects } from '../agent.types';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface ReloadFixture {
  threadId: string;
  history: ThreadState[];
  childStates: Record<string, ThreadState>;
}

function loadFixture(): ReloadFixture {
  return JSON.parse(readFileSync(
    join(__dirname, '..', '..', '..', 'test', 'fixtures', 'reloaded-subagent-thread.json'),
    'utf8',
  )) as ReloadFixture;
}

const CHILD_NS = 'tools:7f3c1a52-0b8e-4d7a-9e61-2a5b8c0d4e19';

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

function setup(transport: MockAgentTransport) {
  const subjects = makeSubjects();
  const destroy$ = new Subject<void>();
  const bridge = createStreamManagerBridge({
    options: { apiUrl: '', assistantId: 'test', transport, subagentToolNames: ['task'] },
    subjects,
    threadId$: of(null),
    destroy$: destroy$.asObservable(),
  });
  return { subjects, destroy$, bridge };
}

/** Let the history read and the child-transcript reads it starts settle. */
function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function reloadTransport(fixture = loadFixture()): MockAgentTransport {
  const transport = new MockAgentTransport();
  transport.history = fixture.history;
  transport.childStates = new Map(Object.entries(fixture.childStates));
  return transport;
}

function raw(message: unknown): Record<string, unknown> {
  return message as Record<string, unknown>;
}

describe('reloading a thread with a delegated subagent', () => {
  it('shows the subagent card under its tool call with its final status, result and transcript', async () => {
    const transport = reloadTransport();
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();

    const card = subjects.subagents$.value.get('call_research');
    expect([...subjects.subagents$.value.keys()]).toEqual(['call_research']);
    expect(card?.toolCallId).toBe('call_research');
    expect(card?.name).toBe('researcher');
    expect(card?.status()).toBe('complete');
    expect(card?.values()).toMatchObject({ result: 'Jet-A averaged $5.80/gal in 2025.' });
    expect(card?.messages().map(message => raw(message)['id'])).toEqual(['child-human-1', 'child-ai-1']);
    // The child state's other keys travel with the transcript, as live values do.
    expect(card?.values()).toHaveProperty('files');
    // The card is anchored to a tool call the parent transcript also shows.
    expect(subjects.toolCalls$.value.map(call => call.id)).toContain('call_research');
    expect(transport.childStateCalls).toEqual([{ threadId: 'thread-reload', checkpointNs: CHILD_NS }]);
    destroy$.next();
  });

  it('restores each assistant message\'s reasoning, without a duration', async () => {
    const transport = reloadTransport();
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();

    const byId = new Map(subjects.messages$.value.map(message => [raw(message)['id'], raw(message)]));
    expect(byId.get('ai-1')?.['reasoning']).toBe('A researcher should gather the prices first.');
    expect(byId.get('ai-2')?.['reasoning']).toBe('The researcher\'s figure answers the question.');
    // History records no reasoning start/end, so no duration is invented.
    expect(bridge.getReasoningDurationMs('ai-2')).toBeUndefined();
    destroy$.next();
  });

  it('keeps streamed reasoning when the run-end refresh returns the persisted message', async () => {
    const transport = new MockAgentTransport();
    const { subjects, destroy$, bridge } = setup(transport);
    bridge.switchThread('t');
    await settle();

    const run = bridge.submit({});
    await transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-r', type: 'AIMessageChunk', content: [{ type: 'reasoning', text: 'weighing it' }, { type: 'text', text: 'Done.' }] }],
      messageMetadata: { langgraph_node: 'model' },
    } as StreamEvent]);
    expect(raw(subjects.messages$.value.at(-1))['reasoning']).toBe('weighing it');
    // The persisted copy keeps only the text; the refresh must not erase the
    // reasoning the user just watched stream.
    transport.history = [{
      values: { messages: [{ id: 'ai-r', type: 'ai', content: 'Done.' }] },
      next: [], checkpoint: { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c', checkpoint_map: null },
      metadata: null, created_at: null, parent_checkpoint: null, tasks: [],
    } as unknown as ThreadState];
    await transport.close();
    await run;

    expect(raw(subjects.messages$.value.at(-1))['reasoning']).toBe('weighing it');
    destroy$.next();
  });

  it('still shows status and result when the transport cannot read child state', async () => {
    const transport = reloadTransport();
    (transport as { getChildState?: unknown }).getChildState = undefined;
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();

    const card = subjects.subagents$.value.get('call_research');
    expect(card?.status()).toBe('complete');
    expect(card?.values()).toMatchObject({ result: 'Jet-A averaged $5.80/gal in 2025.' });
    expect(card?.messages()).toEqual([]);
    destroy$.next();
  });

  it('never fills a child card with state from another namespace', async () => {
    const fixture = loadFixture();
    const transport = reloadTransport(fixture);
    // A transport that ignored the namespace and answered with the parent.
    transport.childStates = new Map([[CHILD_NS, fixture.history[0]]]);
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();

    expect(subjects.subagents$.value.get('call_research')?.messages()).toEqual([]);
    destroy$.next();
  });

  it('drops a child transcript that lands after the thread was switched away', async () => {
    const fixture = loadFixture();
    const transport = reloadTransport(fixture);
    const releases = new Map<string, (state: ThreadState | undefined) => void>();
    transport.getChildState = threadId => new Promise(resolve => { releases.set(threadId, resolve); });
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();
    // The next thread happens to hold a card under the same tool-call id, so a
    // stale write would have somewhere to land.
    bridge.switchThread('another-thread');
    await settle();
    expect(subjects.subagents$.value.get('call_research')?.messages()).toEqual([]);
    releases.get('thread-reload')?.(fixture.childStates[CHILD_NS]);
    await settle();

    expect(subjects.subagents$.value.get('call_research')?.messages()).toEqual([]);
    destroy$.next();
  });

  it('does not re-read a child transcript on every refresh', async () => {
    const transport = reloadTransport();
    const { destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();
    const run = bridge.submit({});
    await transport.close();
    await run;
    await settle();

    expect(transport.childStateCalls).toHaveLength(1);
    destroy$.next();
  });
});

describe('a run that resumes after a reload', () => {
  /**
   * A thread paused mid fan-out: the model dispatched two subagents and both
   * tasks are still outstanding in the latest checkpoint.
   */
  function pausedFanOutHistory(): ThreadState[] {
    const dispatch = {
      id: 'ai-fan', type: 'ai', content: '',
      tool_calls: [
        { id: 'call_fuel', name: 'task', args: { subagent_type: 'researcher', task_description: 'fuel' } },
        { id: 'call_wx', name: 'task', args: { subagent_type: 'weather', task_description: 'wx' } },
      ],
    };
    return [{
      values: { messages: [{ id: 'h', type: 'human', content: 'Plan the flight' }, dispatch] },
      next: ['tools', 'tools'],
      checkpoint: { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'cp-2', checkpoint_map: null },
      metadata: null,
      created_at: '2026-10-08T12:00:02.000Z',
      parent_checkpoint: null,
      tasks: [
        { id: 'uuid-fuel', name: 'tools', path: ['__pregel_push', 0, false], error: null, interrupts: [{ value: 'approve?' }], checkpoint: null, state: null },
        { id: 'uuid-wx', name: 'tools', path: ['__pregel_push', 1, false], error: null, interrupts: [], checkpoint: null, state: null },
      ],
    } as unknown as ThreadState];
  }

  it('streams into the restored cards instead of opening duplicates', async () => {
    const transport = new MockAgentTransport();
    transport.history = pausedFanOutHistory();
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('t');
    await settle();
    expect(subjects.subagents$.value.get('call_fuel')?.status()).toBe('running');
    expect(subjects.subagents$.value.get('call_wx')?.status()).toBe('running');

    const run = bridge.submit(null, { command: { resume: true } });
    // Two children outstanding at once: without the namespaces recovered from
    // history, neither stream could be attributed to a card.
    await transport.emit([
      {
        type: 'messages|tools:uuid-wx' as StreamEvent['type'],
        namespace: ['tools:uuid-wx'],
        messages: [{ id: 'wx-1', type: 'ai', content: 'VFR all day.' }],
      },
      {
        type: 'messages|tools:uuid-fuel' as StreamEvent['type'],
        namespace: ['tools:uuid-fuel'],
        messages: [{ id: 'fuel-1', type: 'ai', content: 'Jet-A $5.80.' }],
      },
    ]);
    // The resumed run's parent state repeats the dispatching tool calls.
    await transport.emit([{
      type: 'values',
      data: { messages: (transport.history[0].values as { messages: unknown[] }).messages },
    } as StreamEvent]);

    expect([...subjects.subagents$.value.keys()].sort()).toEqual(['call_fuel', 'call_wx']);
    expect(subjects.subagents$.value.get('call_fuel')?.messages().map(m => raw(m)['id'])).toEqual(['fuel-1']);
    expect(subjects.subagents$.value.get('call_wx')?.messages().map(m => raw(m)['id'])).toEqual(['wx-1']);
    await transport.close();
    await run;
    destroy$.next();
  });

  it('keeps one card per tool call when a settled thread is reloaded and run again', async () => {
    const fixture = loadFixture();
    const transport = reloadTransport(fixture);
    const { subjects, destroy$, bridge } = setup(transport);

    bridge.switchThread('thread-reload');
    await settle();
    const run = bridge.submit({});
    await transport.emit([{ type: 'values', data: fixture.history[0].values } as StreamEvent]);
    await transport.close();
    await run;
    await settle();

    expect([...subjects.subagents$.value.keys()]).toEqual(['call_research']);
    expect(subjects.subagents$.value.get('call_research')?.status()).toBe('complete');
    destroy$.next();
  });
});

describe('mapChildExecutionsFromHistory', () => {
  it('links a finished task to its tool call through the ToolMessage it produced', () => {
    const fixture = loadFixture();
    const executions = mapChildExecutionsFromHistory(fixture.history, new Set(['call_research']));
    expect(executions.get('call_research')).toEqual({
      toolCallId: 'call_research',
      taskName: 'tools',
      taskId: '7f3c1a52-0b8e-4d7a-9e61-2a5b8c0d4e19',
      checkpointNs: CHILD_NS,
      outstanding: false,
      failed: false,
    });
  });

  it('aligns outstanding tasks by send index against the full tool-call list', () => {
    const history = [{
      values: {
        messages: [{
          id: 'ai', type: 'ai', content: '',
          tool_calls: [
            { id: 'call_search', name: 'search', args: {} },
            { id: 'call_child', name: 'task', args: { subagent_type: 'researcher' } },
          ],
        }],
      },
      tasks: [
        { id: 'uuid-search', name: 'tools', path: ['__pregel_push', 0, false] },
        { id: 'uuid-child', name: 'tools', path: ['__pregel_push', 1, false], error: 'boom' },
      ],
    }] as unknown as ThreadState[];
    const executions = mapChildExecutionsFromHistory(history, new Set(['call_child']));
    expect([...executions.keys()]).toEqual(['call_child']);
    expect(executions.get('call_child')).toMatchObject({ taskId: 'uuid-child', outstanding: true, failed: true });
  });

  it('never lets a positional guess override a result link', () => {
    const toolResult = { type: 'tool', tool_call_id: 'call_a', content: 'done' };
    const history = [
      {
        values: { messages: [{ id: 'ai', type: 'ai', content: '', tool_calls: [{ id: 'call_a', name: 'task', args: {} }] }] },
        tasks: [{ id: 'uuid-retry', name: 'tools', path: ['__pregel_push', 0, false] }],
      },
      {
        values: { messages: [] },
        tasks: [{ id: 'uuid-original', name: 'tools', path: ['__pregel_push', 0, false], result: { messages: [toolResult] } }],
      },
    ] as unknown as ThreadState[];
    expect(mapChildExecutionsFromHistory(history, new Set(['call_a'])).get('call_a')?.taskId).toBe('uuid-original');
  });

  it('omits tool calls history does not link, and ignores pulled node tasks', () => {
    const history = [{
      values: { messages: [{ id: 'ai', type: 'ai', content: 'no tools' }] },
      tasks: [{ id: 'uuid-model', name: 'model', path: ['__pregel_pull', 'model'] }],
    }] as unknown as ThreadState[];
    expect(mapChildExecutionsFromHistory(history, new Set(['call_x'])).size).toBe(0);
  });
});

describe('restoreReasoning', () => {
  const extract = (content: unknown) => Array.isArray(content)
    ? content.filter(block => (block as { type?: string }).type === 'reasoning').map(block => (block as { text: string }).text).join('')
    : '';

  it('derives reasoning from content blocks', () => {
    const restored = [{ id: 'a', type: 'ai', content: [{ type: 'reasoning', text: 'why' }, { type: 'text', text: 'answer' }] }];
    expect(raw(restoreReasoning([], restored as unknown as BaseMessage[], extract)[0])['reasoning']).toBe('why');
  });

  it('keeps on-screen reasoning when the persisted message carries none', () => {
    const previous = [{ id: 'a', type: 'ai', content: 'answer', reasoning: 'streamed thought' }];
    const restored = [{ id: 'a', type: 'ai', content: 'answer' }];
    const [message] = restoreReasoning(previous as unknown as BaseMessage[], restored as unknown as BaseMessage[], extract);
    expect(raw(message)['reasoning']).toBe('streamed thought');
  });

  it('leaves messages without reasoning untouched', () => {
    const restored = [{ id: 'a', type: 'ai', content: 'answer' }] as unknown as BaseMessage[];
    expect(restoreReasoning([], restored, extract)[0]).toBe(restored[0]);
  });
});
