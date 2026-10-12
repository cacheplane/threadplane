import { copyData, record, text, type Authority } from './authority';
import { validScope } from './browser-scope';
export const MEMORY_PATH = '/memories/AGENTS.md';
export const MAX_MEMORY_BYTES = 65536;
export type MemoryMap = Readonly<Record<string, string>>;
/** Strict Unicode scalar validation precedes TextEncoder: lone JS surrogates
 * cannot silently become replacement bytes. This bounds retained display data. */
export function captureMemoryMap(input: unknown): MemoryMap | undefined {
  try {
    const captured = copyData(input, false);
    if (!record(captured)) return undefined;
    const keys = Object.keys(captured);
    if (keys.length > 1 || keys.some((k) => k !== MEMORY_PATH))
      return undefined;
    if (!keys.length) return captured as MemoryMap;
    const value = captured[MEMORY_PATH];
    if (typeof value !== 'string' || value.length > MAX_MEMORY_BYTES)
      return undefined;
    for (let i = 0; i < value.length; i++) {
      const unit = value.charCodeAt(i);
      if (unit >= 0xd800 && unit <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) return undefined;
      } else if (unit >= 0xdc00 && unit <= 0xdfff) return undefined;
    }
    if (new TextEncoder().encode(value).length > MAX_MEMORY_BYTES)
      return undefined;
    return captured as MemoryMap;
  } catch {
    return undefined;
  }
}
export interface MemoryProjectionInput {
  readonly owner: string;
  readonly currentOwner: string;
  readonly generation: string;
  readonly currentGeneration: string;
  readonly scope: string;
  readonly source: 'none' | 'unavailable' | 'custom' | 'checkpoint';
  /** Actual separately observed root custom event, never fabricated native values. */
  readonly event?: unknown;
  readonly authority?: Authority;
}
export type MemoryProjection =
  | Readonly<{ kind: 'none' | 'unavailable' }>
  | Readonly<{
      kind: 'live' | 'checkpoint';
      file: 'missing' | 'present';
      contents?: string;
      scope: string;
      generation: string;
      phase?: 'initial' | 'model' | 'terminal';
      checkpointId?: string;
    }>;
const unavailable: MemoryProjection = Object.freeze({ kind: 'unavailable' });
/** Checkpoint evidence is historical: the file was observed at that run's read
 * time. Neither custom nor checkpoint evidence promises the store is current. */
export function projectMemory(input: unknown): MemoryProjection {
  try {
    const v = copyData(input);
    if (
      !record(v) ||
      !validScope(v.scope) ||
      !text(v.owner) ||
      !text(v.generation) ||
      v.owner !== v.currentOwner ||
      v.generation !== v.currentGeneration
    )
      return unavailable;
    if (v.source === 'none') return Object.freeze({ kind: 'none' });
    let contents: unknown,
      phase: 'initial' | 'model' | 'terminal' | undefined,
      checkpointId: string | undefined;
    if (v.source === 'custom') {
      const event = v.event;
      if (
        !record(event) ||
        event.name !== 'deep_agents.memory' ||
        Object.keys(event).some((k) => !['name', 'data'].includes(k)) ||
        !record(event.data)
      )
        return unavailable;
      const d = event.data;
      if (
        Object.keys(d).length !== 3 ||
        Object.keys(d).some(
          (k) => !['memory_scope_owner', 'memory_contents', 'phase'].includes(k)
        ) ||
        d.memory_scope_owner !== v.scope ||
        !['initial', 'model', 'terminal'].includes(d.phase as string)
      )
        return unavailable;
      contents = d.memory_contents;
      phase = d.phase as typeof phase;
    } else if (v.source === 'checkpoint') {
      const a = v.authority;
      if (
        !record(a) ||
        a.kind !== 'terminal' ||
        !record(a.turn) ||
        a.turn.owner !== v.owner ||
        a.turn.generation !== v.generation ||
        a.turn.memoryScope !== v.scope ||
        !record(a.values) ||
        a.values.memory_scope_owner !== v.scope ||
        !record(a.checkpoint) ||
        !text(a.checkpoint.checkpoint_id)
      )
        return unavailable;
      contents = a.values.memory_contents;
      checkpointId = a.checkpoint.checkpoint_id;
    } else return unavailable;
    const map = captureMemoryMap(contents);
    if (!map) return unavailable;
    const present = Object.hasOwn(map, MEMORY_PATH);
    return Object.freeze({
      kind: v.source === 'custom' ? 'live' : 'checkpoint',
      file: present ? 'present' : 'missing',
      ...(present ? { contents: map[MEMORY_PATH] } : {}),
      scope: v.scope,
      generation: v.generation,
      ...(phase ? { phase } : {}),
      ...(checkpointId ? { checkpointId } : {}),
    });
  } catch {
    return unavailable;
  }
}
