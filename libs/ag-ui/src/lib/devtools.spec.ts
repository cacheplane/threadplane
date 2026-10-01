import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signal } from '@angular/core';
import { EventType, type BaseEvent } from '@ag-ui/client';
import { ɵcreateDevtoolsEmitter } from '@threadplane/chat';
import { toAgent } from './to-agent';
import { FakeAgent } from './testing/fake-agent';
import { instrumentSignals } from './internal/devtools';

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
  'messages', 'status', 'isLoading', 'error', 'toolCalls', 'state', 'interrupt',
  'customEvents', 'activities', 'interruptSession',
]);

let reports: Report[] = [];
const collect = (event: Event) => reports.push((event as CustomEvent<Report>).detail);
const summary = () => reports.map(r => [r.eventType, r.wrote]);

function scripted(events: BaseEvent[]) {
  return new FakeAgent({ delayMs: 0, script: [{ when: 'initial', events }] });
}

describe('devtools signal reports (AG-UI)', () => {
  beforeEach(() => {
    angular.devMode = true;
    reports = [];
    window.addEventListener('threadplane:devtools', collect);
  });
  afterEach(() => window.removeEventListener('threadplane:devtools', collect));

  it('reports, per protocol event, the signals that event wrote', async () => {
    const agent = toAgent(scripted([
      { type: EventType.TEXT_MESSAGE_START, messageId: 'm1', role: 'assistant' } as BaseEvent,
      { type: EventType.TEXT_MESSAGE_CONTENT, messageId: 'm1', delta: 'Hel' } as BaseEvent,
      { type: EventType.TEXT_MESSAGE_END, messageId: 'm1' } as BaseEvent,
      { type: EventType.STATE_SNAPSHOT, snapshot: { count: 1 } } as BaseEvent,
      { type: EventType.STATE_DELTA, delta: [{ op: 'replace', path: '/count', value: 2 }] } as BaseEvent,
      { type: EventType.TOOL_CALL_START, toolCallId: 't1', toolCallName: 'search', parentMessageId: 'm1' } as BaseEvent,
      { type: EventType.TOOL_CALL_ARGS, toolCallId: 't1', delta: '{"q":"x"}' } as BaseEvent,
      { type: EventType.TOOL_CALL_END, toolCallId: 't1' } as BaseEvent,
      { type: EventType.CUSTOM, name: 'progress', value: { step: 1 } } as BaseEvent,
    ]));
    await agent.submit({ message: 'hi' });

    // TEXT_MESSAGE_END wrote nothing, so it has no report; neither does the
    // run opening here, which had no superseded run to settle.
    expect(summary()).toEqual([
      ['submit', ['messages']],
      ['RUN_STARTED', ['status', 'isLoading', 'error', 'interrupt', 'customEvents', 'activities']],
      ['TEXT_MESSAGE_START', ['messages']],
      ['TEXT_MESSAGE_CONTENT', ['messages']],
      ['STATE_SNAPSHOT', ['state', 'messages']],
      ['STATE_DELTA', ['state', 'messages']],
      ['TOOL_CALL_START', ['toolCalls', 'messages']],
      ['TOOL_CALL_ARGS', ['toolCalls']],
      ['TOOL_CALL_END', ['toolCalls']],
      ['CUSTOM', ['customEvents']],
      // Includes the adapter's own settling: interrupt-session publish and commit.
      ['RUN_FINISHED', ['messages', 'status', 'isLoading', 'interruptSession', 'interrupt']],
    ]);
  });

  it('reports a failed run as a protocol RUN_ERROR', async () => {
    const agent = toAgent(scripted([{ type: EventType.RUN_ERROR, message: 'boom' } as BaseEvent]));
    await agent.submit({ message: 'hi' });
    expect(summary().find(([type]) => type === 'RUN_ERROR')).toEqual(
      // Includes the adapter's rollback of optimistic state.
      ['RUN_ERROR', ['messages', 'status', 'isLoading', 'error', 'state']],
    );
  });

  it('labels stop `run:end` and regenerate `submit`', async () => {
    const agent = toAgent(new FakeAgent({ delayMs: 5, tokens: Array.from({ length: 40 }, (_, i) => `t${i}`) }));
    const run = agent.submit({ message: 'hi' });
    await vi.waitFor(() => expect(reports.some(r => r.eventType === 'TEXT_MESSAGE_CONTENT')).toBe(true));
    await agent.stop();
    await run;
    // Rollback of optimistic state, the stopped delivery, then the idle status.
    expect(summary()).toContainEqual(['run:end', ['state', 'messages', 'status', 'isLoading', 'error']]);
    // Events the source still sends for the stopped run write nothing, so they are not reported.
    expect(summary().filter(([type]) => type === 'RUN_FINISHED')).toEqual([]);

    const before = reports.length;
    const assistantIndex = agent.messages().findIndex(m => m.role === 'assistant');
    await agent.regenerate(assistantIndex);
    expect(summary().slice(before, before + 2)).toEqual([
      ['submit', ['messages']],
      ['RUN_STARTED', ['status', 'isLoading', 'error', 'interrupt', 'customEvents', 'activities']],
    ]);
  });

  it('numbers reports per agent instance and keeps every report inside the contract', async () => {
    const one = toAgent(scripted([{ type: EventType.STATE_SNAPSHOT, snapshot: { a: 1 } } as BaseEvent]));
    const two = toAgent(scripted([{ type: EventType.STATE_SNAPSHOT, snapshot: { b: 1 } } as BaseEvent]));
    await Promise.all([one.submit({ message: 'x' }), two.submit({ message: 'y' })]);

    const agents = [...new Set(reports.map(r => r.agent))];
    expect(agents).toHaveLength(2);
    for (const id of agents) {
      const seqs = reports.filter(r => r.agent === id).map(r => r.seq);
      expect(seqs).toEqual(seqs.map((_, i) => i + 1));
    }
    for (const report of reports) {
      expect(Object.keys(report).sort()).toEqual(['adapter', 'agent', 'eventType', 'seq', 'tMs', 'v', 'wrote']);
      expect(report.v).toBe(1);
      expect(report.adapter).toBe('ag-ui');
      expect(report.wrote.length).toBeGreaterThan(0);
      expect(new Set(report.wrote).size).toBe(report.wrote.length);
      for (const name of report.wrote) expect(VOCABULARY.has(name)).toBe(true);
    }
  });

  it('creates no emitter and dispatches nothing outside dev mode', async () => {
    angular.devMode = false;
    const agent = toAgent(scripted([{ type: EventType.STATE_SNAPSHOT, snapshot: { a: 1 } } as BaseEvent]));
    await agent.submit({ message: 'hi' });
    expect(agent.state()).toEqual({ a: 1 });
    expect(reports).toEqual([]);
  });

  it('dispatches nothing when the page opted out', async () => {
    const flagged = window as Window & { __THREADPLANE_DEVTOOLS_DISABLED__?: boolean };
    flagged.__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    try {
      const agent = toAgent(scripted([{ type: EventType.STATE_SNAPSHOT, snapshot: { a: 1 } } as BaseEvent]));
      await agent.submit({ message: 'hi' });
      expect(reports).toEqual([]);
    } finally {
      delete flagged.__THREADPLANE_DEVTOOLS_DISABLED__;
    }
  });

  it('never reads a written value or calls the signal’s getter', () => {
    const emitter = ɵcreateDevtoolsEmitter('ag-ui')!;
    const wrote = vi.spyOn(emitter, 'wrote');
    // Every trap throws: any property read, key enumeration, or coercion of the
    // value by the instrumentation would fail this test.
    const untouchable = new Proxy({}, new Proxy({}, {
      get: (_target, trap) => () => { throw new Error(`value read via ${String(trap)}`); },
    }));
    // A writable signal whose getter throws: the instrumentation may only wrap
    // `set` and `update`, never read the signal.
    const sets: unknown[] = [];
    const updates: unknown[] = [];
    const real = signal<unknown>(undefined);
    const state = Object.assign(() => { throw new Error('signal getter read'); }, {
      set: (value: unknown) => { sets.push(value); },
      update: (fn: unknown) => { updates.push(fn); },
      asReadonly: real.asReadonly,
    });
    instrumentSignals({ state } as unknown as Parameters<typeof instrumentSignals>[0], emitter);
    const updateFn = () => { throw new Error('update callback run by the instrumentation'); };

    expect(() => emitter.outside('submit', () => {
      state.set(untouchable);
      state.update(updateFn);
    })).not.toThrow();
    expect(sets).toHaveLength(1);
    expect(sets[0]).toBe(untouchable);
    expect(updates).toEqual([updateFn]);
    expect(wrote.mock.calls).toEqual([['state'], ['state']]);
    expect(reports.map(r => r.wrote)).toEqual([['state']]);
  });
});
