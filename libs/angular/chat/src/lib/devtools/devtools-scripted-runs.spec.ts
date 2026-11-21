import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createScriptedRunStore,
  ɵdevtoolsScriptedRuns,
  SCRIPTED_RUN_LIMITS,
  type ScriptedRunClock,
  type ScriptedRunStore,
} from './devtools-scripted-runs';

const angular = vi.hoisted(() => ({ devMode: true }));
vi.mock('@angular/core', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  isDevMode: () => angular.devMode,
}));

/** The ack contract the AG-UI DevTools extension validates. */
interface Ack {
  v: 1;
  armId: string;
  state: 'armed' | 'consumed' | 'expired' | 'disarmed' | 'rejected';
  run?: number;
  reason?: string;
}

type Global = typeof globalThis & { ngDevMode?: unknown; __THREADPLANE_DEVTOOLS_DISABLED__?: unknown };

/** A clock whose time only moves when the test says so. */
function manualClock() {
  let time = 1_000;
  let timers: { at: number; run: () => void; id: number }[] = [];
  let ids = 0;
  const clock: ScriptedRunClock & { advance(ms: number): void; pending(): number } = {
    now: () => time,
    setTimeout(run, ms) {
      const id = ++ids;
      timers.push({ at: time + ms, run, id });
      return id;
    },
    clearTimeout(handle) {
      timers = timers.filter(t => t.id !== handle);
    },
    advance(ms) {
      time += ms;
      const due = timers.filter(t => t.at <= time);
      timers = timers.filter(t => t.at > time);
      for (const t of due) t.run();
    },
    pending: () => timers.length,
  };
  return clock;
}

const acks: Ack[] = [];
const collect = (event: Event) => acks.push((event as CustomEvent<Ack>).detail);

const arm = (detail: unknown) => window.dispatchEvent(new CustomEvent('threadplane:devtools:arm', { detail }));
const disarm = (detail: unknown) => window.dispatchEvent(new CustomEvent('threadplane:devtools:disarm', { detail }));
const lgRun = (...events: string[]) => ({ frames: events.map(event => ({ event, data: { n: event } })) });
const agRun = (...types: string[]) => ({ events: types.map(type => ({ type })) });

describe('scripted run store', () => {
  let clock: ReturnType<typeof manualClock>;
  let store: ScriptedRunStore;

  beforeEach(() => {
    acks.length = 0;
    clock = manualClock();
    store = createScriptedRunStore(window, clock);
    window.addEventListener('threadplane:devtools:ack', collect);
  });
  afterEach(() => {
    store.dispose();
    window.removeEventListener('threadplane:devtools:ack', collect);
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
  });

  it('serves armed runs in order, once each, acknowledging every step', () => {
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [lgRun('values'), lgRun('values', 'custom')] });
    expect(store.take('ag-ui')).toBeNull();
    expect(store.take('langgraph')).toEqual(lgRun('values'));
    expect(store.take('langgraph')).toEqual(lgRun('values', 'custom'));
    expect(store.take('langgraph')).toBeNull();
    expect(acks).toEqual([
      { v: 1, armId: 'a1', state: 'armed' },
      { v: 1, armId: 'a1', state: 'consumed', run: 0 },
      { v: 1, armId: 'a1', state: 'consumed', run: 1 },
    ]);
    // Fully consumed: its expiry timer is gone too.
    expect(clock.pending()).toBe(0);
  });

  it('keeps one pending arm per adapter; a new arm replaces the old and acks it disarmed', () => {
    arm({ v: 1, armId: 'old', adapter: 'ag-ui', runs: [agRun('RUN_STARTED'), agRun('RUN_STARTED')] });
    arm({ v: 1, armId: 'lg', adapter: 'langgraph', runs: [lgRun('values')] });
    expect(store.take('ag-ui')).toEqual(agRun('RUN_STARTED'));
    arm({ v: 1, armId: 'new', adapter: 'ag-ui', runs: [agRun('RUN_ERROR')] });
    expect(store.take('ag-ui')).toEqual(agRun('RUN_ERROR'));
    expect(store.take('ag-ui')).toBeNull();
    // The other adapter's arm is untouched.
    expect(store.take('langgraph')).toEqual(lgRun('values'));
    expect(acks).toEqual([
      { v: 1, armId: 'old', state: 'armed' },
      { v: 1, armId: 'lg', state: 'armed' },
      { v: 1, armId: 'old', state: 'consumed', run: 0 },
      { v: 1, armId: 'old', state: 'disarmed' },
      { v: 1, armId: 'new', state: 'armed' },
      { v: 1, armId: 'new', state: 'consumed', run: 0 },
      { v: 1, armId: 'lg', state: 'consumed', run: 0 },
    ]);
  });

  it('disarms by armId; an unknown or finished arm is ignored silently', () => {
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [lgRun('values')] });
    disarm({ v: 1, armId: 'nope' });
    disarm({ v: 2, armId: 'a1' });
    disarm({ armId: 'a1' });
    expect(acks).toEqual([{ v: 1, armId: 'a1', state: 'armed' }]);
    disarm({ v: 1, armId: 'a1' });
    expect(store.take('langgraph')).toBeNull();
    disarm({ v: 1, armId: 'a1' });
    expect(acks).toEqual([
      { v: 1, armId: 'a1', state: 'armed' },
      { v: 1, armId: 'a1', state: 'disarmed' },
    ]);
    expect(clock.pending()).toBe(0);
  });

  it('expires an arm ten minutes after arming, by timer', () => {
    arm({ v: 1, armId: 'a1', adapter: 'ag-ui', runs: [agRun('RUN_STARTED'), agRun('RUN_STARTED')] });
    expect(store.take('ag-ui')).not.toBeNull();
    clock.advance(SCRIPTED_RUN_LIMITS.ttlMs - 1);
    expect(acks.at(-1)?.state).toBe('consumed');
    clock.advance(1);
    expect(acks.at(-1)).toEqual({ v: 1, armId: 'a1', state: 'expired' });
    expect(store.take('ag-ui')).toBeNull();
    expect(SCRIPTED_RUN_LIMITS.ttlMs).toBe(600_000);
  });

  it('expires by deadline when the timer lags', () => {
    const lagging = manualClock();
    lagging.setTimeout = () => 0; // a timer that never fires
    store.dispose();
    store = createScriptedRunStore(window, lagging);
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [lgRun('values')] });
    lagging.advance(SCRIPTED_RUN_LIMITS.ttlMs);
    expect(store.take('langgraph')).toBeNull();
    expect(acks).toEqual([
      { v: 1, armId: 'a1', state: 'armed' },
      { v: 1, armId: 'a1', state: 'expired' },
    ]);
  });

  it('rejects invalid arms with a reason and leaves the pending arm alone', () => {
    arm({ v: 1, armId: 'keep', adapter: 'langgraph', runs: [lgRun('values')] });
    const tooMany = Array.from({ length: SCRIPTED_RUN_LIMITS.runs + 1 }, () => lgRun('values'));
    const tooLong = { frames: Array.from({ length: SCRIPTED_RUN_LIMITS.itemsPerRun + 1 }, () => ({ event: 'values', data: {} })) };
    const atLimit = { frames: Array.from({ length: SCRIPTED_RUN_LIMITS.itemsPerRun }, () => ({ event: 'values', data: {} })) };
    const huge = { frames: [{ event: 'values', data: { blob: 'x'.repeat(SCRIPTED_RUN_LIMITS.bytes) } }] };
    const cyclic: Record<string, unknown> = {};
    cyclic['self'] = cyclic;
    const throwing = { v: 1, armId: 'r12', adapter: 'langgraph', get runs(): never { throw new Error('boom'); } };
    const cases: [string, unknown][] = [
      ['r1', { v: 2, armId: 'r1', adapter: 'langgraph', runs: [lgRun('values')] }],
      ['r2', { v: 1, armId: 'r2', adapter: 'crewai', runs: [lgRun('values')] }],
      ['r3', { v: 1, armId: 'r3', adapter: 'langgraph', runs: [] }],
      ['r4', { v: 1, armId: 'r4', adapter: 'langgraph', runs: tooMany }],
      ['r5', { v: 1, armId: 'r5', adapter: 'langgraph', runs: [tooLong] }],
      ['r6', { v: 1, armId: 'r6', adapter: 'langgraph', runs: [huge] }],
      ['r7', { v: 1, armId: 'r7', adapter: 'langgraph', runs: [{ frames: [{ event: 'values', data: cyclic }] }] }],
      ['r8', { v: 1, armId: 'r8', adapter: 'langgraph', runs: [agRun('RUN_STARTED')] }],
      ['r9', { v: 1, armId: 'r9', adapter: 'ag-ui', runs: [{ events: [{ delta: 'no type' }] }] }],
      ['r10', { v: 1, armId: 'r10', adapter: 'langgraph', runs: [{ frames: ['values'] }] }],
      ['r11', { v: 1, armId: 'r11', adapter: 'ag-ui', runs: 'all of them' }],
      ['r12', throwing],
    ];
    for (const [, detail] of cases) arm(detail);
    expect(acks.slice(1).map(a => [a.armId, a.state])).toEqual(cases.map(([id]) => [id, 'rejected']));
    expect(acks.slice(1).map(a => a.reason)).toEqual([
      'unsupported version',
      'unknown adapter',
      'runs must list 1 to 8 runs',
      'runs must list 1 to 8 runs',
      'run 0 has more than 5000 frames',
      'arm exceeds 2 MB',
      'arm is not serializable',
      'run 0 has no frames list',
      'run 0 event 0 has no type',
      'run 0 frame 0 is not an object',
      'runs must list 1 to 8 runs',
      'arm is malformed',
    ]);
    for (const a of acks.slice(1)) expect(Object.keys(a).sort()).toEqual(['armId', 'reason', 'state', 'v']);
    expect(store.take('langgraph')).toEqual(lgRun('values'));

    // The limits are inclusive.
    arm({ v: 1, armId: 'max', adapter: 'langgraph', runs: Array.from({ length: SCRIPTED_RUN_LIMITS.runs }, () => atLimit) });
    expect(acks.at(-1)).toEqual({ v: 1, armId: 'max', state: 'armed' });
  });

  it('ignores an arm with no usable armId, since nothing could correlate an answer', () => {
    arm({ v: 1, adapter: 'langgraph', runs: [lgRun('values')] });
    arm({ v: 1, armId: '', adapter: 'langgraph', runs: [lgRun('values')] });
    arm({ v: 1, armId: 'x'.repeat(SCRIPTED_RUN_LIMITS.armIdLength + 1), adapter: 'langgraph', runs: [lgRun('values')] });
    arm('not an object');
    arm(null);
    expect(acks).toEqual([]);
    expect(store.take('langgraph')).toBeNull();
  });

  it('serves a detached copy, so the page cannot rewrite an armed run afterwards', () => {
    const frames = [{ event: 'values', data: { answer: 1 } }];
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [{ frames }] });
    frames[0].data.answer = 2;
    frames.push({ event: 'error', data: { answer: 3 } });
    expect(store.take('langgraph')).toEqual({ frames: [{ event: 'values', data: { answer: 1 } }] });
  });

  it('does nothing while the page has opted out', () => {
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [lgRun('values')] });
    (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    expect(store.take('langgraph')).toBeNull();
    arm({ v: 1, armId: 'a2', adapter: 'langgraph', runs: [lgRun('values')] });
    disarm({ v: 1, armId: 'a1' });
    expect(acks).toEqual([{ v: 1, armId: 'a1', state: 'armed' }]);
  });

  it('swallows an ack dispatch failure, so the run is still served', () => {
    arm({ v: 1, armId: 'a1', adapter: 'langgraph', runs: [lgRun('values')] });
    const dispatch = vi.spyOn(window, 'dispatchEvent').mockImplementation(() => { throw new Error('dispatch failure'); });
    try {
      expect(store.take('langgraph')).toEqual(lgRun('values'));
      expect(dispatch).toHaveBeenCalledTimes(1);
    } finally {
      dispatch.mockRestore();
    }
  });
});

describe('ɵdevtoolsScriptedRuns gate', () => {
  const originalNgDevMode = (globalThis as Global).ngDevMode;
  afterEach(() => {
    angular.devMode = true;
    (globalThis as Global).ngDevMode = originalNgDevMode;
    delete (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__;
    vi.restoreAllMocks();
  });

  it('is null and installs no listener in production, outside dev mode, or when opted out', () => {
    const added = vi.spyOn(window, 'addEventListener');
    (globalThis as Global).ngDevMode = false;
    expect(ɵdevtoolsScriptedRuns('langgraph')).toBeNull();
    (globalThis as Global).ngDevMode = originalNgDevMode;
    angular.devMode = false;
    expect(ɵdevtoolsScriptedRuns('ag-ui')).toBeNull();
    angular.devMode = true;
    (window as unknown as Global).__THREADPLANE_DEVTOOLS_DISABLED__ = true;
    expect(ɵdevtoolsScriptedRuns('ag-ui')).toBeNull();
    expect(added.mock.calls.map(([type]) => type).filter(type => String(type).startsWith('threadplane:'))).toEqual([]);
  });

  it('installs the page listeners once, on the first development call', () => {
    const added = vi.spyOn(window, 'addEventListener');
    const lg = ɵdevtoolsScriptedRuns('langgraph')!;
    const ag = ɵdevtoolsScriptedRuns('ag-ui')!;
    expect(lg).not.toBeNull();
    expect(ag).not.toBeNull();
    expect(added.mock.calls.map(([type]) => type).filter(type => String(type).startsWith('threadplane:')))
      .toEqual(['threadplane:devtools:arm', 'threadplane:devtools:disarm']);

    acks.length = 0;
    window.addEventListener('threadplane:devtools:ack', collect);
    try {
      arm({ v: 1, armId: 'page', adapter: 'ag-ui', runs: [agRun('RUN_STARTED')] });
      expect(lg.take()).toBeNull();
      expect(ag.take()).toEqual(agRun('RUN_STARTED'));
      expect(acks.map(a => a.state)).toEqual(['armed', 'consumed']);
    } finally {
      window.removeEventListener('threadplane:devtools:ack', collect);
    }
  });
});
