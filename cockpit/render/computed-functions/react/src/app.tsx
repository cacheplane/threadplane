import { useEffect, useSyncExternalStore } from 'react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry } from './views';
import { localFunctions } from './functions';

export function ComputedDemo({
  playback,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const state = useSyncExternalStore(
    playback.subscribe,
    playback.getSnapshot,
    playback.getSnapshot
  );
  useEffect(onReady, [onReady]);
  const phase =
    state.phase === 'error'
      ? 'Unavailable'
      : state.phase[0].toUpperCase() + state.phase.slice(1);
  return (
    <main className="spec-demo">
      <header>
        <p className="eyebrow">React · Experimental</p>
        <h1>Computed Functions</h1>
      </header>
      <p>
        Watch three local samples transform text, multiply numbers and format
        dates. Calculations wait for complete arguments. Dates follow your
        browser’s locale.
      </p>
      <section aria-label="Playback controls" className="controls">
        <label>
          Sample
          <select
            value={state.selected}
            onChange={(event) => playback.select(Number(event.target.value))}
          >
            {samples.map((label, index) => (
              <option key={index} value={index}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="buttons">
          <button
            type="button"
            disabled={state.phase === 'error'}
            onClick={state.playing ? playback.pause : playback.play}
          >
            {state.playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            disabled={state.phase === 'error'}
            onClick={playback.finish}
          >
            Finish
          </button>
          <button type="button" onClick={playback.reset}>
            Reset
          </button>
        </div>
        <label>
          Playback position
          <input
            type="range"
            min={0}
            max={state.total}
            step={1}
            value={state.position}
            disabled={state.phase === 'error'}
            onChange={(event) => playback.seek(Number(event.target.value))}
          />
        </label>
        <p role="status">
          {phase} · {state.position} characters
        </p>
        {state.phase === 'error' && (
          <p role="alert">
            This sample could not be displayed. Choose another sample to
            continue.
          </p>
        )}
      </section>
      <div className="panels">
        <section aria-label="Render output">
          <h2>Render output</h2>
          {state.spec ? (
            <RenderSpec
              spec={state.spec}
              registry={localRegistry}
              functions={localFunctions}
              loading={state.position < state.total}
            />
          ) : (
            <p className="empty">Play a sample to see its view.</p>
          )}
        </section>
        <section aria-label="Streaming JSON">
          <h2>Streaming JSON</h2>
          <pre>{state.rawJson}</pre>
        </section>
      </div>
    </main>
  );
}
