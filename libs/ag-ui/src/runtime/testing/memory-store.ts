import type { SessionPersistence, ThreadRecord } from '../thread-store';

/** An in-memory compare-and-swap store, for specs. Records are copied in and out. */
export function memoryStore() {
  const records = new Map<string, ThreadRecord>();
  const calls = { load: 0, compareAndSwap: 0 };
  const store: SessionPersistence['store'] = {
    load: async (key) => {
      calls.load++;
      const record = records.get(key);
      return record ? structuredClone(record) : null;
    },
    compareAndSwap: async (key, expectedRevision, next) => {
      calls.compareAndSwap++;
      if ((records.get(key)?.revision ?? null) !== expectedRevision)
        return false;
      records.set(key, structuredClone(next));
      return true;
    },
  };
  return {
    store,
    records,
    calls,
    /** The one record of `threadId` under `namespace`. */
    record: (namespace: string, threadId: string) =>
      records.get(JSON.stringify([namespace, threadId])),
  };
}
