import { useEffect, useState, useSyncExternalStore } from 'react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry } from './views';
import { createInitialState, editState } from './state';

export function StateDemo({
  playback,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const [host, setHost] = useState(createInitialState);
  const [ageDraft, setAgeDraft] = useState('30');
  const [ageError, setAgeError] = useState<string | null>(null);
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
        <h1>State Management</h1>
      </header>
      <p>
        Edit the local state and watch its values appear in the view. Playback
        controls keep your edits.
      </p>
      <section aria-label="State controls" className="controls">
        <label>
          Name
          <input
            type="text"
            maxLength={256}
            value={host.user.name}
            onChange={(event) => {
              const value = event.target.value;
              setHost((previous) => editState(previous, 'name', value).state);
            }}
          />
        </label>
        <label>
          Age
          <input
            type="number"
            min={0}
            max={150}
            step={1}
            value={ageDraft}
            aria-invalid={ageError !== null}
            aria-describedby={ageError ? 'age-error' : undefined}
            onChange={(event) => {
              const draft = event.target.value;
              const edited = editState(host, 'age', draft);
              setAgeDraft(draft);
              setAgeError(edited.error);
              setHost(edited.state);
            }}
          />
        </label>
        <label>
          Theme
          <select
            value={host.settings.theme}
            onChange={(event) => {
              const value = event.target.value;
              setHost((previous) => editState(previous, 'theme', value).state);
            }}
          >
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </label>
        {ageError && (
          <p id="age-error" role="alert">
            {ageError}
          </p>
        )}
        <p>
          Theme changes the displayed value. Reloading restores Alice, age 30,
          and Dark.
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
              state={host}
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
