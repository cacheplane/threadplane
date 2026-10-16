import { useEffect, useSyncExternalStore } from 'react';
import type { RenderStateSnapshot } from '@threadplane/content/render-state';
import { useAgent } from '@threadplane/react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry } from './views';

export function ElementRenderingDemo({
  playback,
  renderState,
  onShowDetailChange,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly renderState: {
    readonly getSnapshot: () => RenderStateSnapshot;
    readonly subscribe: (notify: () => void) => () => void;
  };
  readonly onShowDetailChange: (value: boolean) => void;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const renderSnapshot = useAgent(renderState);
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
        <h1>Element Rendering</h1>
      </header>
      <p>
        Render ordered children and nested views. Choose whether the native
        renderer shows the conditional detail.
      </p>
      <section aria-label="Visibility controls" className="controls">
        <label className="visibility-toggle">
          <input
            type="checkbox"
            checked={renderSnapshot.showDetail === true}
            onChange={(event) => onShowDetailChange(event.target.checked)}
          />
          Show detail
        </label>
        <p>
          Your choice survives playback and sample changes. Reloading shows
          detail.
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
              registry={localRegistry}
              state={renderSnapshot}
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
