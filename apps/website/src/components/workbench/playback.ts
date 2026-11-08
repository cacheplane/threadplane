import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';

/** Playback owns only a cursor. It cannot submit, fetch, or execute a tool. */
export interface Playback {
  readonly cursor: number;
  readonly playing: boolean;
}

export function seek(cursor: number, count: number): number {
  return Math.max(
    0,
    Math.min(
      Math.max(0, count - 1),
      Number.isFinite(cursor) ? Math.floor(cursor) : 0
    )
  );
}

export function step(cursor: number, direction: number, count: number): number {
  return seek(cursor + direction, count);
}

export function frameAt<T>(frames: readonly T[], cursor: number): T | null {
  return frames[seek(cursor, frames.length)] ?? null;
}

export function startPlayback(cursor: number, count: number): Playback {
  return {
    cursor: cursor >= count - 1 ? 0 : seek(cursor, count),
    playing: count > 1,
  };
}

export function advancePlayback(playback: Playback, count: number): Playback {
  if (!playback.playing) return playback;
  const cursor = step(playback.cursor, 1, count);
  return { cursor, playing: cursor < count - 1 };
}

export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };
export interface Observation {
  readonly id: string;
  readonly label: string;
  readonly elapsedMs: number;
  readonly messages: readonly {
    readonly id: string;
    readonly role: string;
    readonly text: string;
  }[];
  readonly state: Json;
  readonly calls?: InspectionFrame['calls'];
  readonly requests: readonly {
    readonly id: string;
    readonly method: string;
    readonly path: string;
    readonly body: Json;
    readonly status: number | null;
  }[];
  readonly event: { readonly type: string; readonly payload: Json };
}
export interface Recording {
  readonly version: number;
  readonly provenance: {
    readonly kind: string;
    readonly description: string;
    readonly source: string;
  };
  readonly frames: readonly Observation[];
}
