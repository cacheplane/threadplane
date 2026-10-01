import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { agent } from './agent.fn';
import { MockAgentTransport } from './transport/mock-stream.transport';
import { instrumentSubjects } from './internals/devtools';
import { ɵcreateDevtoolsEmitter } from '@threadplane/chat';

const angular = vi.hoisted(() => ({ devMode: true }));
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDevMode: () => angular.devMode,
}));

/** The report contract the AG-UI DevTools extension validates. */
interface Report {
  v: 1;
  agent: string;
  adapter: 'langgraph' | 'ag-ui';
  seq: number;
  eventType: string;
  wrote: string[];
  tMs: number;
}
const VOCABULARY = new Set([
  'status', 'values', 'messages', 'error', 'interrupt', 'interrupts', 'branch', 'history',
  'isThreadLoading', 'toolProgress', 'toolCalls', 'messageMetadata', 'subagents', 'queue', 'custom',
]);

let reports: Report[] = [];
const collect = (event: Event) => reports.push((event as CustomEvent<Report>).detail);

function create(transport = new MockAgentTransport()) {
  let ref!: ReturnType<typeof agent>;
  TestBed.runInInjectionContext(() => {
    ref = agent({ assistantId: 'test', transport, throttle: 0 });
  });
  return { ref, transport };
}

/** Event type → names, for the reports after the given index. */
const summary = (from = 0) => reports.slice(from).map(r => [r.eventType, r.wrote]);

describe('devtools signal reports (LangGraph)', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({});
    angular.devMode = true;
    reports = [];
    window.addEventListener('threadplane:devtools', collect);
  });
  afterEach(() => window.removeEventListener('threadplane:devtools', collect));

  it('reports, per stream event, the subjects that event wrote', async () => {
    const { ref, transport } = create();
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    const afterStart = reports.length;

    await transport.emit([{
      type: 'messages',
      messages: [{ id: 'ai-1', type: 'ai', content: 'hel' }],
      messageMetadata: { langgraph_node: 'model' },
    }]);
    await transport.emit([{
      type: 'values',
      data: { messages: [{ id: 'h-1', type: 'human', content: 'hi' }, { id: 'ai-1', type: 'ai', content: 'hello' }], topic: 'greeting' },
    }]);
    await transport.emit([{ type: 'updates', data: { topic: 'farewell' } }]);
    await transport.emit([{ type: 'custom', data: { name: 'progress', data: { step: 1 } } }]);
    await transport.emit([{ type: 'error', error: new Error('boom') }]);
    await transport.close();
    await run;

    expect(summary(afterStart)).toEqual([
      ['messages', ['messages', 'messageMetadata', 'subagents', 'toolCalls']],
      ['values', ['values', 'messages', 'subagents', 'toolCalls']],
      ['updates', ['values']],
      ['custom', ['custom']],
      // Settling the attempt settles its running subgraphs before the error lands.
      ['error', ['subagents', 'error', 'status']],
    ]);
  });

  it('labels the writes that open a run `run:start` and those that settle it `run:end`', async () => {
    const { ref, transport } = create();
    const run = ref.submit({ message: 'hi' });
    await transport.flush();
    expect(summary()).toEqual([
      ['run:start', ['status', 'error', 'custom', 'toolProgress', 'messages']],
    ]);
    await transport.emit([{ type: 'values', data: { done: true } }]);
    await transport.close();
    await run;
    expect(summary()).toEqual([
      ['run:start', ['status', 'error', 'custom', 'toolProgress', 'messages']],
      ['values', ['values']],
      // Settling the attempt completes running subgraphs; then the run resolves.
      ['run:end', ['subagents']],
      ['run:end', ['status']],
    ]);
  });

  it('labels user actions outside a stream: branch, reset, retry', async () => {
    const { ref, transport } = create();
    ref.setBranch('alt');
    ref.switchThread('thread-2');
    const run = ref.submit({ message: 'hi' });
    await transport.emit([{ type: 'error', error: new Error('boom') }]);
    await transport.close();
    await run;
    const afterFailure = reports.length;
    const retried = ref.retry();
    await transport.flush();
    await transport.close();
    await retried;

    expect(summary().slice(0, 2)).toEqual([
      ['branch', ['branch']],
      ['reset', [
        'status', 'error', 'values', 'messages', 'history', 'interrupt', 'interrupts', 'toolProgress',
        'toolCalls', 'messageMetadata', 'subagents', 'queue', 'custom', 'isThreadLoading',
      ]],
    ]);
    expect(summary(afterFailure).slice(0, 2)).toEqual([
      ['submit', ['error']],
      // The resubmitted request carries the user message again.
      ['run:start', ['status', 'error', 'custom', 'toolProgress', 'messages']],
    ]);
  });

  it('labels a history refresh `history`', async () => {
    const transport = new MockAgentTransport();
    transport.history = [{
      values: { messages: [{ id: 'h-1', type: 'human', content: 'hi' }], topic: 'x' },
      next: [], checkpoint: { thread_id: 't', checkpoint_ns: '', checkpoint_id: 'c1', checkpoint_map: null },
      metadata: null, created_at: '2026-09-30T00:00:00.000Z', parent_checkpoint: null, tasks: [],
    }];
    TestBed.runInInjectionContext(() => agent({ assistantId: 'test', transport, threadId: 'thread-1', throttle: 0 }));
    await vi.waitFor(() => expect(reports.length).toBe(3));
    expect(summary()).toEqual([
      ['history', ['isThreadLoading']],
      ['history', ['history', 'messages', 'values', 'toolCalls']],
      ['history', ['isThreadLoading']],
    ]);
  });

  it('numbers reports per agent instance and keeps every report inside the contract', async () => {
    const one = create();
    const two = create();
    const a = one.ref.submit({});
    const b = two.ref.submit({});
    await one.transport.emit([{ type: 'values', data: { x: 1 } }]);
    await two.transport.emit([{ type: 'values', data: { y: 1 } }]);
    await one.transport.close();
    await two.transport.close();
    await Promise.all([a, b]);

    const agents = [...new Set(reports.map(r => r.agent))];
    expect(agents).toHaveLength(2);
    for (const id of agents) {
      const seqs = reports.filter(r => r.agent === id).map(r => r.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
    for (const report of reports) {
      expect(Object.keys(report).sort()).toEqual(['adapter', 'agent', 'eventType', 'seq', 'tMs', 'v', 'wrote']);
      expect(report.v).toBe(1);
      expect(report.adapter).toBe('langgraph');
      expect(report.wrote.length).toBeGreaterThan(0);
      expect(new Set(report.wrote).size).toBe(report.wrote.length);
      for (const name of report.wrote) expect(VOCABULARY.has(name)).toBe(true);
    }
  });

  it('creates no emitter and dispatches nothing outside dev mode', async () => {
    angular.devMode = false;
    const { ref, transport } = create();
    const run = ref.submit({ message: 'hi' });
    await transport.emit([{ type: 'values', data: { x: 1 } }]);
    await transport.close();
    await run;
    expect(reports).toEqual([]);
  });

  it('dispatches nothing when the page opted out', async () => {
    const flagged = window as Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: boolean };
    flagged.__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    try {
      const { ref, transport } = create();
      const run = ref.submit({});
      await transport.emit([{ type: 'values', data: { x: 1 } }]);
      await transport.close();
      await run;
      expect(reports).toEqual([]);
    } finally {
      delete flagged.__THREADPLANE_DEVTOOLS_DISABLED__;
    }
  });

  it('never reads a written value or a subject’s current value', () => {
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    const wrote = vi.spyOn(emitter, 'wrote');
    // Every trap throws: any property read, key enumeration, or coercion of the
    // value by the instrumentation would fail this test.
    const untouchable = new Proxy({}, new Proxy({}, {
      get: (_target, trap) => () => { throw new Error(`value read via ${String(trap)}`); },
    }));
    const subject = new BehaviorSubject<unknown>(undefined);
    // The subject's own value accessors throw too.
    Object.defineProperty(subject, 'value', { get: () => { throw new Error('value getter read'); } });
    subject.getValue = () => { throw new Error('getValue read'); };
    const received: unknown[] = [];
    const bag = { values$: subject };
    instrumentSubjects(bag as unknown as Parameters<typeof instrumentSubjects>[0], emitter);
    // Subscribing after instrumentation proves the value still reaches observers untouched.
    subject.subscribe({ next: v => received.push(v) });
    // BehaviorSubject replays its initial value on subscribe without the getter.
    received.length = 0;

    expect(() => emitter.outside('history', () => subject.next(untouchable))).not.toThrow();
    expect(received).toHaveLength(1);
    expect(received[0]).toBe(untouchable);
    expect(wrote.mock.calls).toEqual([['values']]);
    expect(reports.map(r => r.wrote)).toEqual([['values']]);
  });
});
