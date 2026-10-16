import { useEffect, useState, useSyncExternalStore } from 'react';
import { useAgent } from '@threadplane/react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry } from './views';
import type { DemoObserver, StateEditor } from './state';

export function StateDemo({
  playback,
  renderState,
  onStateEdit,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly renderState: DemoObserver;
  readonly onStateEdit: StateEditor;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const host = useAgent(renderState);
  const [ageInput, setAgeInput] = useState(() => ({
    observer: renderState,
    age: host.user.age,
    draft: String(host.user.age),
    error: null as string | null,
  }));
  // React retries this component before committing its children. Keeping this
  // presentation in React state retires accepted spellings on committed changes
  // without mutating refs or the owner during rendering.
  if (
    ageInput.observer !== renderState ||
    (ageInput.error === null && ageInput.age !== host.user.age)
  ) {
    setAgeInput({
      observer: renderState,
      age: host.user.age,
      draft: String(host.user.age),
      error: null,
    });
  }
  const ageDraft = ageInput.draft;
  const ageError = ageInput.error;
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
              onStateEdit('name', value);
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
              const error = onStateEdit('age', draft);
              setAgeInput({
                observer: renderState,
                draft,
                error,
                age: error === null ? Number(draft) : host.user.age,
              });
            }}
          />
        </label>
        <label>
          Theme
          <select
            value={host.settings.theme}
            onChange={(event) => {
              const value = event.target.value;
              onStateEdit('theme', value);
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
