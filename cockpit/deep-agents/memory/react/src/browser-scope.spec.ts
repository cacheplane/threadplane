import { describe, expect, it } from 'vitest';
import { createBrowserScope, SCOPE_KEY, validScope } from './browser-scope';
const scope = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function setup(value: string | null = scope) {
  let current = value,
    reads = 0,
    writes = 0,
    generated = 0;
  let failRead = false,
    failWrite = false,
    winner: string | null | undefined;
  const listeners = new Set<(event: any) => void>();
  const storage = {
    getItem(key: string) {
      expect(key).toBe(SCOPE_KEY);
      reads++;
      if (failRead) throw Error();
      return current;
    },
    setItem(key: string, value: string) {
      expect(key).toBe(SCOPE_KEY);
      writes++;
      if (failWrite) throw Error();
      current = winner === undefined ? value : winner;
    },
  };
  const events = {
    addEventListener(_: string, listener: any) {
      listeners.add(listener);
    },
    removeEventListener(_: string, listener: any) {
      listeners.delete(listener);
    },
  };
  return {
    create: () =>
      createBrowserScope({
        storage: () => storage,
        uuid: () => {
          generated++;
          return scope;
        },
        events,
      }),
    set: (v: string | null) => {
      current = v;
    },
    emit: (
      key = SCOPE_KEY,
      newValue: string | null = current,
      storageArea: unknown = storage
    ) => listeners.forEach((l) => l({ key, newValue, storageArea })),
    failRead: () => {
      failRead = true;
    },
    failWrite: () => {
      failWrite = true;
    },
    winner: (v: string | null) => {
      winner = v;
    },
    counts: () => ({ reads, writes, generated, listeners: listeners.size }),
  };
}
describe('immutable browser memory scope', () => {
  it.each([scope, other])(
    'captures existing valid scope %s without writes',
    (value) => {
      const s = setup(value);
      const b = s.create();
      expect(b?.getSnapshot()).toMatchObject({ status: 'ready', scope: value });
      expect(b?.admit()).toEqual({ memory_scope: value });
      expect(s.counts()).toMatchObject({ writes: 0, generated: 0 });
    }
  );
  it('generates only when missing and captures the competing readback winner', () => {
    const s = setup(null);
    s.winner(other);
    const b = s.create();
    expect(b?.admit()).toEqual({ memory_scope: other });
    expect(s.counts()).toMatchObject({ writes: 1, generated: 1 });
  });
  it.each([
    '',
    'garbage',
    'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
    '11111111-1111-5111-8111-111111111111',
    '11111111-1111-4111-7111-111111111111',
    ` ${scope}`,
  ])('blocks corrupt existing value %s without repair', (value) => {
    const s = setup(value);
    const b = s.create();
    expect(b?.getSnapshot().status).toBe('blocked');
    expect(b?.admit()).toBeUndefined();
    expect(s.counts()).toMatchObject({ writes: 0, generated: 0 });
  });
  it('blocks unavailable storage, write/read errors and invalid generated UUID', () => {
    for (const options of [
      {
        storage: () => {
          throw Error();
        },
        uuid: () => scope,
      },
      {
        storage: () => ({
          getItem: () => null,
          setItem: () => {
            throw Error();
          },
        }),
        uuid: () => scope,
      },
      {
        storage: () => ({ getItem: () => null, setItem: () => undefined }),
        uuid: () => scope,
      },
      {
        storage: () => ({
          getItem: () => null,
          setItem: () => {
            throw Error('must not write');
          },
        }),
        uuid: () => 'bad',
      },
    ])
      expect(createBrowserScope(options)?.getSnapshot().status).toBe('blocked');
    const s = setup(null);
    s.failWrite();
    expect(s.create()?.getSnapshot().status).toBe('blocked');
    const t = setup();
    t.failRead();
    expect(t.create()?.getSnapshot().status).toBe('blocked');
  });
  it.each([null, other])(
    'rechecks every action and permanently blocks same-window replacement %s',
    (value) => {
      const s = setup();
      const b = s.create();
      const inflight = b?.admit();
      s.set(value);
      expect(b?.admit()).toBeUndefined();
      expect(b?.getSnapshot()).toMatchObject({
        status: 'blocked',
        scope,
        warning: expect.any(String),
      });
      expect(inflight).toEqual({ memory_scope: scope });
      expect(Object.isFrozen(inflight)).toBe(true);
      s.set(scope);
      expect(b?.admit()).toBeUndefined();
    }
  );
  it('reacts to storage changes during an active generation and cleans subscriptions on dispose', () => {
    const s = setup();
    const b = s.create();
    const context = b?.admit();
    let updates = 0;
    const unsubscribe = b?.subscribe(() => updates++);
    s.emit('unrelated', other);
    expect(b?.getSnapshot().status).toBe('ready');
    s.set(other);
    s.emit();
    expect(b?.getSnapshot().status).toBe('blocked');
    expect(context).toEqual({ memory_scope: scope });
    expect(updates).toBe(1);
    unsubscribe?.();
    b?.dispose();
    expect(s.counts().listeners).toBe(0);
    expect(b?.admit()).toBeUndefined();
  });
  it('blocks a deletion event and a read failure after capture', () => {
    const s = setup();
    const b = s.create();
    s.emit(SCOPE_KEY, null);
    expect(b?.getSnapshot().status).toBe('blocked');
    const t = setup();
    const c = t.create();
    t.failRead();
    expect(c?.admit()).toBeUndefined();
  });
  it('validates UUID variant/version/case exactly', () => {
    expect(validScope(scope)).toBe(true);
    expect(validScope('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')).toBe(true);
    expect(validScope('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toBe(false);
    expect(validScope(null)).toBe(false);
  });
});

it('blocks readback errors and rejects invalid winners after exactly one initialization write', () => {
  let reads = 0,
    writes = 0;
  const b = createBrowserScope({
    storage: () => ({
      getItem: () => {
        if (++reads === 1) return null;
        throw Error('readback unavailable');
      },
      setItem: () => {
        writes++;
      },
    }),
    uuid: () => scope,
  });
  expect(b.getSnapshot().status).toBe('blocked');
  expect(writes).toBe(1);
  expect(reads).toBe(2);
  const s = setup(null);
  s.winner('invalid');
  expect(s.create().getSnapshot().status).toBe('blocked');
  expect(s.counts()).toMatchObject({ writes: 1, generated: 1 });
});
it('handles storage clear and ignores events belonging to other storage areas', () => {
  const s = setup();
  const b = s.create();
  s.emit(SCOPE_KEY, other, {});
  expect(b.getSnapshot().status).toBe('ready');
  s.emit(null as any, null);
  expect(b.getSnapshot().status).toBe('blocked');
  b.dispose();
  b.dispose();
  expect(s.counts().listeners).toBe(0);
});
