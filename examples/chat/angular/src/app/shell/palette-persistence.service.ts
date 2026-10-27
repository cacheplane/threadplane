import { Injectable } from '@angular/core';

const KEY = 'threadplane-chat-demo:palette';

interface PaletteState {
  model?: string | null;
  effort?: string | null;
  genUiMode?: string | null;
  theme?: string | null;
  drawerOpen?: boolean | null;
  sidenavMode?: 'expanded' | 'collapsed' | null;
  selectedProjectId?: string | null;
  colorScheme?: 'light' | 'dark' | null;
  appMode?: 'on' | 'off' | null;
}

type PaletteKey = keyof PaletteState;

/**
 * Allowed value sets for enum-like palette fields. Kept here (local allowlist
 * approach) because the shell component declares these as private signals —
 * extracting/exporting them from the component would add coupling for little
 * gain. Update these whenever the dropdown options in demo-shell.component.ts
 * change.
 */
const ALLOWED = {
  model:       new Set(['gpt-5', 'gpt-5-mini', 'gpt-5-nano']),
  effort:      new Set(['default', 'minimal', 'low', 'medium', 'high']),
  genUiMode:   new Set(['a2ui', 'json-render']),
  theme:       new Set(['default-dark', 'default-light', 'material-dark', 'material-light']),
  colorScheme: new Set<string>(['light', 'dark']),
  sidenavMode: new Set<string>(['expanded', 'collapsed']),
  appMode:     new Set<string>(['on', 'off']),
} as const satisfies Partial<Record<PaletteKey, ReadonlySet<string>>>;

type EnumKey = keyof typeof ALLOWED;

/**
 * Tiny localStorage-backed persistence for control-palette state. Single
 * JSON object under `threadplane-chat-demo:palette` so reads/writes are
 * atomic-per-key. Survives malformed JSON by returning `null` and
 * silently overwriting on next write.
 *
 * Enum-like fields (model, effort, genUiMode, theme, colorScheme,
 * sidenavMode) are validated against their current allowed value sets on
 * read: a stale value (e.g. a renamed enum member from a previous release)
 * returns `null` so the caller's `?? default` falls back cleanly.
 * Non-enum fields (selectedProjectId, drawerOpen) pass through unchanged.
 */
@Injectable({ providedIn: 'root' })
export class PalettePersistence {
  read<K extends PaletteKey>(key: K): PaletteState[K] | null {
    const raw = this.load();
    const value = (raw[key] as PaletteState[K] | undefined) ?? null;

    if (key in ALLOWED && value !== null && value !== undefined) {
      const allowed = ALLOWED[key as EnumKey] as ReadonlySet<string>;
      if (!allowed.has(value as string)) return null;
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
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return typeof parsed === 'object' && parsed !== null ? (parsed as PaletteState) : {};
    } catch {
      return {};
    }
  }
}
