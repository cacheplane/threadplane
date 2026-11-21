export interface Persistence {
  read<T = unknown>(key: string): T | undefined;
  write<T = unknown>(key: string, value: T): void;
}

/**
 * Tiny typed localStorage wrapper namespaced under `{prefix}:`. SSR-safe:
 * when `localStorage` is undefined (server build), read returns undefined
 * and write is a no-op.
 */
export function createPersistence(prefix: string): Persistence {
  const fullKey = (k: string) => `${prefix}:${k}`;
  return {
    read<T = unknown>(key: string): T | undefined {
      if (typeof localStorage === 'undefined') return undefined;
      const raw = localStorage.getItem(fullKey(key));
      if (raw === null) return undefined;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return undefined;
      }
    },
    write<T = unknown>(key: string, value: T): void {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem(fullKey(key), JSON.stringify(value));
    },
  };
}
