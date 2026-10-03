import { useEffect, useState, useSyncExternalStore } from 'react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry, withoutBadgeRegistry, FallbackBadge } from './views';

export function RegistryDemo({
  playback,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const [mode, setMode] = useState('registered');
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
        <h1>Component Registry</h1>
      </header>
      <p>
        Choose how the registry handles Badge elements. The native renderer can
        display a registered view, omit it, or use an authored fallback.
      </p>
      <section aria-label="Registry controls" className="controls">
        <label>
          Badge display
          <select
            value={mode}
            onChange={(event) => {
              const value = event.target.value;
              if (['registered', 'omitted', 'fallback'].includes(value))
                setMode(value);
            }}
          >
            <option value="registered">Registered</option>
            <option value="omitted">Omitted</option>
            <option value="fallback">Fallback</option>
          </select>
        </label>
        <p>
          Registry choice survives playback and sample changes. Reloading
          restores Registered.
        </p>
      </section>
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
              registry={
                mode === 'registered' ? localRegistry : withoutBadgeRegistry
              }
              fallback={mode === 'fallback' ? FallbackBadge : undefined}
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
