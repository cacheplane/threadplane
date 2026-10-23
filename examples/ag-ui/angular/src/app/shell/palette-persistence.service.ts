import { Injectable } from '@angular/core';

const KEY = 'threadplane-ag-ui-demo:palette';

interface PaletteState {
  model: string;
  effort: string;
  genUiMode: string;
  theme: string;
  colorScheme: string;
  appMode: 'on' | 'off';
}

type PaletteKey = keyof PaletteState;

/**
 * Allowed value sets for enum-like palette fields. Kept here (local allowlist
 * approach) because the shell component declares these as private signals —
 * extracting/exporting them from the component would add coupling for little
 * gain. Update these whenever the dropdown options in ag-ui-shell.component.ts
 * change.
 */
const ALLOWED: Record<PaletteKey, ReadonlySet<string>> = {
  model:       new Set(['gpt-5-mini', 'gpt-5-nano']),
  effort:      new Set(['default', 'minimal', 'low', 'medium', 'high']),
  genUiMode:   new Set(['a2ui', 'json-render']),
  theme:       new Set(['default-dark', 'default-light', 'material-dark', 'material-light']),
  colorScheme: new Set(['light', 'dark']),
  appMode:     new Set(['on', 'off']),
};

/**
 * Tiny localStorage-backed persistence for control-palette state. Single
 * JSON object under `threadplane-ag-ui-demo:palette` so reads/writes are
 * atomic-per-key. Survives malformed JSON by returning `null` and
 * silently overwriting on next write.
 *
 * All fields are enum-like and are validated against their current allowed
 * value sets on read: a stale value (e.g. a renamed enum member from a
 * previous release) returns `null` so the caller's `?? default` falls back
 * cleanly.
 */
@Injectable({ providedIn: 'root' })
export class PalettePersistence {
  read<K extends PaletteKey>(key: K): PaletteState[K] | null {
    const raw = this.load();
    const value = (raw[key] as PaletteState[K] | undefined) ?? null;

    if (value !== null && value !== undefined) {
      if (!ALLOWED[key].has(value as string)) return null;
    }

    return value;
  }

  write<K extends PaletteKey>(key: K, value: PaletteState[K] | null): void {
    const current = this.load();
    if (value === null || value === undefined) {
      delete current[key];
    } else {
      current[key] = value;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // Storage may be full or unavailable (private mode). Silently drop;
      // the demo continues to work, just without persistence.
    }
  }

  private load(): PaletteState {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return {} as PaletteState;
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as PaletteState) : {} as PaletteState;
    } catch {
      return {} as PaletteState;
    }
  }
}
