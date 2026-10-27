export type DebugDock = 'left' | 'right' | 'bottom';
export type DebugTab = 'state' | 'timeline';
export interface DebugPreferences {
  readonly open: boolean;
  readonly dock: DebugDock;
  readonly tab: DebugTab;
}
export interface DebugStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}
/** Construct during render, restore after hydration, then write UI changes.
 * Storage access is injected so imports and SSR never touch browser globals.
 * Use a distinct application-scoped key for each independent panel.
 */
export function createDebugPreferences(
  key: string,
  storage?: DebugStorage,
  defaultOpen = false
) {
  let restored = false;
  let initial: DebugPreferences = Object.freeze({
    open: defaultOpen,
    dock: 'right',
    tab: 'state',
  });
  return {
    restore(): DebugPreferences {
      if (restored) return initial;
      restored = true;
      try {
        const raw = storage?.getItem(key);
        if (raw != null) {
          const value: unknown = JSON.parse(raw);
          if (validPreferences(value)) initial = copyPreferences(value);
        }
      } catch {
        /* Denied storage and malformed JSON retain defaults. */
      }
      return initial;
    },
    write(value: DebugPreferences): void {
      if (!restored) return;
      try {
        if (validPreferences(value))
          storage?.setItem(key, JSON.stringify(copyPreferences(value)));
      } catch {
        /* UI still works when storage is denied. */
      }
    },
  };
}

function validPreferences(value: unknown): value is DebugPreferences {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prefs = value as Partial<DebugPreferences>;
  return (
    typeof prefs.open === 'boolean' &&
    (prefs.dock === 'left' ||
      prefs.dock === 'right' ||
      prefs.dock === 'bottom') &&
    (prefs.tab === 'state' || prefs.tab === 'timeline')
  );
}

function copyPreferences(value: DebugPreferences): DebugPreferences {
  return Object.freeze({ open: value.open, dock: value.dock, tab: value.tab });
}
