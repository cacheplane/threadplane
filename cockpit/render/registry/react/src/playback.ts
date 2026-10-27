import type { RenderSpecData } from '@threadplane/react/render';
import { createPartialJsonParser, materialize } from '@cacheplane/partial-json';
import { projectPartialSpec, validateCompleteSpec } from './projection';

export interface PlaybackSample {
  readonly label: string;
  readonly json: string;
}
export interface FrameScheduler {
  request(callback: FrameRequestCallback): number;
  cancel(id: number): void;
}
export interface PlaybackSnapshot {
  readonly selected: number;
  readonly label: string;
  readonly position: number;
  readonly total: number;
  readonly phase: 'paused' | 'playing' | 'complete' | 'error';
  readonly playing: boolean;
  readonly rawJson: string;
  readonly spec: RenderSpecData | null;
}
export interface Playback {
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  play(): void;
  pause(): void;
  seek(position: number): void;
  select(index: number): void;
  finish(): void;
  reset(): void;
  dispose(): void;
}

export function createPlayback(
  samples: readonly PlaybackSample[],
  scheduler: FrameScheduler = {
    request: (callback) => requestAnimationFrame(callback),
    cancel: (id) => cancelAnimationFrame(id),
  }
): Playback {
  const owned = samples.map((sample) => ({
    label: sample.label,
    json: sample.json,
  }));
  const listeners = new Set<() => void>();
  let live = true;
  let generation = 0;
  let frame: number | undefined;
  let parser = createPartialJsonParser();
  let admitted: RenderSpecData | null = null;
  let snapshot: PlaybackSnapshot;

  function revoke(): number {
    generation++;
    if (frame !== undefined) scheduler.cancel(frame);
    frame = undefined;
    return generation;
  }

  function publish(next: PlaybackSnapshot): void {
    snapshot = Object.freeze(next);
    const current = generation;
    for (const listener of [...listeners]) {
      if (!live || current !== generation) break;
      if (!listeners.has(listener)) continue;
      try {
        listener();
      } catch {
        /* A subscriber cannot take ownership of playback. */
      }
    }
  }

  function initialize(selected: number, notify: boolean): void {
    parser = createPartialJsonParser();
    admitted = null;
    const sample = owned[selected];
    try {
      if (!sample || sample.json.length > 16 * 1024)
        throw Error('Invalid sample');
      // Incremental parsers can retain malformed input as streaming forever.
      admitted = validateCompleteSpec(JSON.parse(sample.json));
    } catch {
      /* Only authored, bounded complete JSON may be played. */
    }
    const next: PlaybackSnapshot = {
      selected,
      label: sample?.label ?? 'Unavailable sample',
      position: 0,
      total: sample?.json.length ?? 0,
      phase: admitted ? 'paused' : 'error',
      playing: false,
      rawJson: '',
      spec: null,
    };
    if (notify) publish(next);
    else snapshot = Object.freeze(next);
  }

  function advance(position: number, playing: boolean): void {
    const source = owned[snapshot.selected].json;
    try {
      parser.push(source.slice(snapshot.position, position));
      const complete = position === source.length;
      if (complete) parser.finish();
      const value = parser.root ? materialize(parser.root) : null;
      const spec = complete
        ? validateCompleteSpec(value)
        : projectPartialSpec(value);
      if (
        complete &&
        (parser.root?.status !== 'complete' ||
          JSON.stringify(spec) !== JSON.stringify(admitted))
      )
        throw Error('Incomplete sample');
      publish({
        ...snapshot,
        position,
        rawJson: source.slice(0, position),
        spec,
        playing: playing && !complete,
        phase: complete ? 'complete' : playing ? 'playing' : 'paused',
      });
    } catch {
      revoke();
      publish({
        ...snapshot,
        phase: 'error',
        playing: false,
        rawJson: '',
        spec: null,
      });
    }
  }

  function schedule(current: number): void {
    if (
      !live ||
      generation !== current ||
      !snapshot.playing ||
      frame !== undefined
    )
      return;
    frame = scheduler.request(() => {
      if (!live || generation !== current || !snapshot.playing) return;
      frame = undefined;
      advance(Math.min(snapshot.total, snapshot.position + 4), true);
      schedule(current);
    });
  }

  function seek(position: number): void {
    if (!live || !Number.isFinite(position) || !admitted) return;
    revoke();
    parser = createPartialJsonParser();
    const target = Math.max(0, Math.min(snapshot.total, Math.floor(position)));
    // Rebuild privately, then publish once so a subscriber cannot interrupt a reset.
    snapshot = Object.freeze({
      ...snapshot,
      position: 0,
      rawJson: '',
      spec: null,
      playing: false,
      phase: 'paused',
    });
    advance(target, false);
  }

  initialize(0, false);
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      if (live) listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    play() {
      if (!live || !admitted || snapshot.playing) return;
      const current = revoke();
      if (snapshot.phase === 'complete') {
        parser = createPartialJsonParser();
        snapshot = Object.freeze({
          ...snapshot,
          position: 0,
          rawJson: '',
          spec: null,
        });
      }
      publish({ ...snapshot, playing: true, phase: 'playing' });
      schedule(current);
    },
    pause() {
      if (!live || !snapshot.playing) return;
      revoke();
      publish({ ...snapshot, playing: false, phase: 'paused' });
    },
    seek,
    select(index) {
      if (
        !live ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= owned.length
      )
        return;
      revoke();
      initialize(index, true);
    },
    finish() {
      seek(snapshot.total);
    },
    reset() {
      seek(0);
    },
    dispose() {
      if (!live) return;
      live = false;
      revoke();
      listeners.clear();
      snapshot = Object.freeze({
        ...snapshot,
        playing: false,
        phase: snapshot.phase === 'playing' ? 'paused' : snapshot.phase,
      });
    },
  };
}
