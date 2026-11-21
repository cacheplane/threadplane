// libs/angular/chat/src/lib/a2ui/partial-args-bridge.spec.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import type { A2uiMessage } from '@threadplane/a2ui';
import { createPartialArgsBridge } from './partial-args-bridge';
import { createA2uiSurfaceStore, type A2uiSurfaceStore } from './surface-store';

function makeStore(): A2uiSurfaceStore {
  let store!: A2uiSurfaceStore;
  TestBed.configureTestingModule({});
  TestBed.runInInjectionContext(() => {
    store = createA2uiSurfaceStore();
  });
  return store;
}

const CS_S = '{"version":"v0.9","createSurface":{"surfaceId":"s","catalogId":"basic"}}';
const UC_ROOT = '{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Text","text":"hi"}]}}';

describe('createPartialArgsBridge', () => {
  let store: A2uiSurfaceStore;
  beforeEach(() => { store = makeStore(); });

  it('mounts a surface once createSurface + root component are parsed', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-1', '{"envelopes":[' + CS_S + ',');
    expect(store.surfaces().has('s')).toBe(false);
    bridge.push('tc-1', '{"envelopes":[' + CS_S + ',' + UC_ROOT + ',');
    expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
  });

  it('synthesises a createSurface when the stream leads with updateComponents', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-2', '{"envelopes":[' + UC_ROOT + ']}');
    const surface = store.surfaces().get('s');
    expect(surface).toBeTruthy();
    expect(surface!.components.has('root')).toBe(true);
    expect(surface!.catalogId).toContain('catalogs/basic');
  });

  it('does not double-create when the LLM emits its own createSurface later', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-3', '{"envelopes":[' + UC_ROOT + ',' + CS_S + ']}');
    const surface = store.surfaces().get('s');
    expect(surface).toBeTruthy();
    expect(surface!.components.size).toBe(1);
    // The real createSurface refreshed catalogId (idempotent refresh).
    expect(surface!.catalogId).toBe('basic');
  });

  it('handles the singular {envelope:[...]} shape', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-4', '{"envelope":[' + UC_ROOT + ']}');
    expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
  });

  it('handles positional keys {0: env, 1: env}', () => {
    const bridge = createPartialArgsBridge(store);
    const envs = [
      JSON.parse(UC_ROOT),
      { version: 'v0.9', updateDataModel: { surfaceId: 's', path: '/msg', value: 'hi' } },
    ];
    bridge.push('tc-5', JSON.stringify({ 0: envs[0], 1: envs[1] }));
    expect(store.surfaces().get('s')?.dataModel).toEqual({ msg: 'hi' });
  });

  it('marks tool_call_id as live in the store once envelopes dispatch', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-6', '{"envelopes":[' + UC_ROOT + ']}');
    expect(store.isPartialLive('tc-6')).toBe(true);
  });

  it('does not dispatch the same envelope twice across incremental pushes', () => {
    const bridge = createPartialArgsBridge(store);
    const piece1 = '{"envelopes":[' + UC_ROOT;
    const piece2 = piece1 + ',{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/k","value":"v"}}]}';
    bridge.push('tc-7', piece1);
    bridge.push('tc-7', piece2);
    // The updateDataModel appears only in the second push but bridge re-runs the parser
    // against the cumulative buffer; the updateComponents envelope must NOT re-dispatch.
    expect(store.surfaces().get('s')?.dataModel).toEqual({ k: 'v' });
  });

  it('marks tool_call_id as poisoned if a chunk is invalid JSON garbage', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-8', '{{{not_json');
    // Subsequent valid pushes are ignored once poisoned.
    bridge.push('tc-8', '{"envelopes":[' + UC_ROOT + ']}');
    expect(store.surfaces().size).toBe(0);
  });

  it('keeps the surface unmounted until a root component is defined (v0.9 rule)', () => {
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-9', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"only","component":"Text","text":"x"}]}}]}');
    expect(store.surfaces().has('s')).toBe(false);
    bridge.push('tc-9', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"only","component":"Text","text":"x"}]}},{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"id":"root","component":"Card","child":"only"}]}}]}');
    expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
    expect(store.surfaces().get('s')?.components.has('only')).toBe(true);
  });

  it('incremental push waits for a complete updateComponents before dispatching', () => {
    const bridge = createPartialArgsBridge(store);
    // 1: object started, components array not yet an array of complete objects.
    bridge.push('tc-10', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{');
    expect(store.surfaces().has('s')).toBe(false);
    // 2: started the "id" key but no value yet.
    bridge.push('tc-10', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"s","components":[{"');
    expect(store.surfaces().has('s')).toBe(false);
    // 3: complete envelope closed.
    bridge.push('tc-10', '{"envelopes":[' + UC_ROOT + ',');
    expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
  });

  it('mounts the surface on first complete push and applies an updateDataModel on a later push', () => {
    const bridge = createPartialArgsBridge(store);
    const dm = '{"version":"v0.9","updateDataModel":{"surfaceId":"s","path":"/greeting","value":"hello"}}';
    bridge.push('tc-11', '{"envelopes":[' + UC_ROOT + ']}');
    expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
    expect(store.surfaces().get('s')?.dataModel).toEqual({});
    bridge.push('tc-11', '{"envelopes":[' + UC_ROOT + ',' + dm + ']}');
    expect(store.surfaces().get('s')?.dataModel).toEqual({ greeting: 'hello' });
  });

  it('synthesised createSurface targets the basic catalog and precedes the components', () => {
    // Spy on applyPartialArgs to inspect the synthesised envelope order.
    const captured: A2uiMessage[][] = [];
    const orig = store.applyPartialArgs.bind(store);
    (store as { applyPartialArgs: typeof store.applyPartialArgs }).applyPartialArgs = (
      toolCallId: string,
      envs: readonly A2uiMessage[],
    ) => {
      captured.push(envs.slice() as A2uiMessage[]);
      orig(toolCallId, envs);
    };
    const bridge = createPartialArgsBridge(store);
    bridge.push('tc-12', '{"envelopes":[' + UC_ROOT + ']}');
    expect(captured.length).toBeGreaterThan(0);
    const firstBatch = captured[0];
    expect('createSurface' in firstBatch[0]).toBe(true);
    expect('updateComponents' in firstBatch[1]).toBe(true);
    const cs = (firstBatch[0] as { createSurface: { catalogId: string } }).createSurface;
    expect(cs.catalogId).toContain('catalogs/basic/catalog.json');
  });
});

interface BridgeRow {
  name: string;
  /** Sequence of (toolCallId, argsSoFar) pushes. */
  pushes: ReadonlyArray<readonly [string, string]>;
  /** Assertion run after the final push. */
  assert: (store: A2uiSurfaceStore, bridge: ReturnType<typeof createPartialArgsBridge>) => void;
}

const SURFACE_S_FULL = '{"envelopes":[' + CS_S + ',' + UC_ROOT + ']}';

const bridgeRows: BridgeRow[] = [
  {
    name: 'open brace then closed brace stays unpoisoned',
    pushes: [['tc-2', '{'], ['tc-2', '{}']],
    assert: (store, bridge) => {
      expect(store.surfaces().size).toBe(0);
      expect(bridge.isPoisoned('tc-2')).toBe(false);
    },
  },
  {
    name: 'open envelopes array stays unpoisoned',
    pushes: [['tc-3', '{"envelopes":[']],
    assert: (store, bridge) => {
      expect(store.surfaces().size).toBe(0);
      expect(bridge.isPoisoned('tc-3')).toBe(false);
    },
  },
  {
    name: 'trailing whitespace after valid args',
    pushes: [['tc-4', SURFACE_S_FULL + '   \n  ']],
    assert: (store) => {
      expect(store.surfaces().get('s')?.components.has('root')).toBe(true);
    },
  },
  {
    name: 'garbage prefix poisons',
    pushes: [['tc-5', '{{{not_json']],
    assert: (_store, bridge) => {
      expect(bridge.isPoisoned('tc-5')).toBe(true);
    },
  },
  {
    name: 'valid prefix then garbage suffix poisons',
    pushes: [['tc-6', SURFACE_S_FULL + ' garbage']],
    assert: (_store, bridge) => {
      expect(bridge.isPoisoned('tc-6')).toBe(true);
    },
  },
  {
    name: 'two tool_call_ids mount independent surfaces',
    pushes: [
      ['tc-7a', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"a","components":[{"id":"root","component":"Text","text":"A"}]}}]}'],
      ['tc-7b', '{"envelopes":[{"version":"v0.9","updateComponents":{"surfaceId":"b","components":[{"id":"root","component":"Text","text":"B"}]}}]}'],
    ],
    assert: (store) => {
      expect(store.surfaces().get('a')?.components.has('root')).toBe(true);
      expect(store.surfaces().get('b')?.components.has('root')).toBe(true);
    },
  },
  {
    name: 'identical chunk pushed twice mounts exactly once',
    pushes: [['tc-8', SURFACE_S_FULL], ['tc-8', SURFACE_S_FULL]],
    assert: (store) => {
      expect(store.surfaces().get('s')?.components.size).toBe(1);
    },
  },
];

describe('createPartialArgsBridge — input variance', () => {
  it.each(bridgeRows)('$name', (row) => {
    const store = makeStore();
    const bridge = createPartialArgsBridge(store);
    for (const [tc, args] of row.pushes) bridge.push(tc, args);
    row.assert(store, bridge);
  });
});
