import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ɵcreateDevtoolsEmitter } from './devtools-emitter';

const angular = vi.hoisted(() => ({ devMode: true }));
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDevMode: () => angular.devMode,
}));

/**
 * The contract the AG-UI DevTools extension validates (its copy lives in that
 * repository). Kept here verbatim so a drift on this side fails a test.
 */
interface ThreadplaneDevtoolsReport {
  v: 1;
  agent: string;
  adapter: 'langgraph' | 'ag-ui';
  seq: number;
  eventType: string;
  wrote: string[];
  tMs: number;
}
const REPORT_KEYS = ['adapter', 'agent', 'eventType', 'seq', 'tMs', 'v', 'wrote'];

type Global = typeof globalThis & { ngDevMode?: unknown; __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

function listen(): ThreadplaneDevtoolsReport[] {
  const reports: ThreadplaneDevtoolsReport[] = [];
  const listener = (event: Event) => reports.push((event as CustomEvent<ThreadplaneDevtoolsReport>).detail);
  window.addEventListener('threadplane:devtools', listener);
  cleanups.push(() => window.removeEventListener('threadplane:devtools', listener));
  return reports;
}
const cleanups: Array<() => void> = [];

describe('ɵcreateDevtoolsEmitter', () => {
  // Angular's test environment defines the global itself and reads it while
  // resetting TestBed, so restore it rather than deleting it.
  const originalNgDevMode = (globalThis as Global).ngDevMode;
  beforeEach(() => {
    angular.devMode = true;
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    (globalThis as Global).ngDevMode = originalNgDevMode;
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });

  it('dispatches one report per event in the contract shape', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    const before = performance.now();
    emitter.begin('messages');
    emitter.wrote('messages');
    emitter.wrote('toolCalls');
    emitter.end();

    expect(reports).toHaveLength(1);
    const [report] = reports;
    expect(Object.keys(report).sort()).toEqual(REPORT_KEYS);
    expect(report).toMatchObject({ v: 1, adapter: 'langgraph', seq: 1, eventType: 'messages', wrote: ['messages', 'toolCalls'] });
    expect(typeof report.agent).toBe('string');
    expect(report.agent.length).toBeGreaterThan(0);
    expect(report.agent.length).toBeLessThanOrEqual(64);
    expect(report.tMs).toBeGreaterThanOrEqual(before);
    expect(report.tMs).toBeLessThanOrEqual(performance.now());
  });

  it('dedupes names, keeps first-write order, and numbers reports per agent from 1', () => {
    const reports = listen();
    const a = ɵcreateDevtoolsEmitter('ag-ui')!;
    const b = ɵcreateDevtoolsEmitter('ag-ui')!;
    a.begin('RUN_STARTED');
    a.wrote('status'); a.wrote('isLoading'); a.wrote('status'); a.wrote('error'); a.wrote('isLoading');
    a.end();
    a.outside('submit', () => a.wrote('messages'));
    b.outside('submit', () => b.wrote('messages'));

    expect(reports.map(r => [r.seq, r.eventType, r.wrote])).toEqual([
      [1, 'RUN_STARTED', ['status', 'isLoading', 'error']],
      [2, 'submit', ['messages']],
      [1, 'submit', ['messages']],
    ]);
    expect(reports[0].agent).toBe(reports[1].agent);
    expect(reports[2].agent).not.toBe(reports[0].agent);
  });

  it('dispatches nothing for an event that wrote nothing, and does not consume a seq', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    emitter.begin('updates');
    emitter.end();
    emitter.outside('history', () => undefined);
    emitter.begin('values'); emitter.wrote('values'); emitter.end();
    expect(reports.map(r => [r.seq, r.eventType])).toEqual([[1, 'values']]);
  });

  it('joins a nested bracket into the outer report', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    emitter.begin('values');
    emitter.wrote('values');
    const result = emitter.outside('queue', () => { emitter.wrote('queue'); return 42; });
    emitter.wrote('messages');
    emitter.end();
    expect(result).toBe(42);
    expect(reports.map(r => [r.eventType, r.wrote])).toEqual([['values', ['values', 'queue', 'messages']]]);
  });

  it('drops names outside the adapter vocabulary and writes outside any bracket', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('ag-ui')!;
    (emitter.wrote as (name: string) => void)('messages');
    emitter.begin('STATE_DELTA');
    (emitter.wrote as (name: string) => void)('values'); // LangGraph-only
    (emitter.wrote as (name: string) => void)('usage'); // not in the contract
    emitter.wrote('state');
    emitter.end();
    emitter.end(); // unmatched: ignored
    expect(reports.map(r => r.wrote)).toEqual([['state']]);
  });

  it('limits eventType to 128 characters', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('ag-ui')!;
    emitter.begin('X'.repeat(500)); emitter.wrote('messages'); emitter.end();
    expect(reports[0].eventType).toHaveLength(128);
  });

  it('closes the bracket and rethrows when the bracketed work throws', () => {
    const reports = listen();
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    expect(() => emitter.outside('reset', () => { emitter.wrote('values'); throw new Error('boom'); })).toThrow('boom');
    emitter.begin('error'); emitter.wrote('error'); emitter.end();
    expect(reports.map(r => [r.seq, r.eventType])).toEqual([[1, 'reset'], [2, 'error']]);
  });

  it('swallows a dispatch failure so the reporting agent is unaffected', () => {
    const dispatch = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('dispatch failure'); });
    cleanups.push(() => dispatch.mockRestore());
    const emitter = ɵcreateDevtoolsEmitter('langgraph')!;
    expect(() => emitter.outside('run:start', () => emitter.wrote('status'))).not.toThrow();
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  describe('gating', () => {
    it('is null when Angular is not in dev mode', () => {
      angular.devMode = false;
      expect(ɵcreateDevtoolsEmitter('langgraph')).toBeNull();
      expect(ɵcreateDevtoolsEmitter('ag-ui')).toBeNull();
    });

    it('is null when the build defines ngDevMode as false', () => {
      (globalThis as Global).ngDevMode = false;
      expect(ɵcreateDevtoolsEmitter('langgraph')).toBeNull();
    });

    it('is created when ngDevMode is set (Angular dev builds define it as an object)', () => {
      (globalThis as Global).ngDevMode = {};
      expect(ɵcreateDevtoolsEmitter('langgraph')).not.toBeNull();
    });

    it('is null when the page opted out before the agent was created', () => {
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
      expect(ɵcreateDevtoolsEmitter('ag-ui')).toBeNull();
    });

    it('stops dispatching when the page opts out later', () => {
      const reports = listen();
      const emitter = ɵcreateDevtoolsEmitter('ag-ui')!;
      emitter.outside('submit', () => emitter.wrote('messages'));
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
      emitter.outside('submit', () => emitter.wrote('messages'));
      expect(reports).toHaveLength(1);
    });

    it('treats only `true` as the opt-out', () => {
      (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = 'yes';
      expect(ɵcreateDevtoolsEmitter('ag-ui')).not.toBeNull();
    });
  });
});
