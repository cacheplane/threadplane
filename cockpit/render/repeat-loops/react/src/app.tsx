import { useEffect, useState, useSyncExternalStore } from 'react';
import { RenderSpec } from '@threadplane/react/render';
import type { Playback } from './playback';
import { localRegistry } from './views';
import {
  createItems,
  addItem,
  removeItem,
  reverseItems,
  MAX_ITEMS,
} from './items';

export function RepeatDemo({
  playback,
  samples,
  onReady,
}: {
  readonly playback: Playback;
  readonly samples: readonly string[];
  readonly onReady: () => void;
}) {
  const [host, setHost] = useState(createItems);
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
        <h1>Repeat Loops</h1>
      </header>
      <p>
        Add, remove and reorder local items. Each row keeps its identity when
        the list changes. Playback controls keep your edits.
      </p>
      <section aria-label="Item controls" className="controls">
        <div className="buttons">
          <button
            type="button"
            disabled={host.items.length >= MAX_ITEMS}
            onClick={() => setHost(addItem)}
          >
            Add Item
          </button>
          <button
            type="button"
            disabled={host.items.length < 2}
            onClick={() => setHost(reverseItems)}
          >
            Reverse items
          </button>
        </div>
        <p>
          {host.items.length} of {MAX_ITEMS} items. Reloading restores Alpha,
          Beta and Gamma.
        </p>
        <div className="buttons">
          {host.items.map((item) => (
            <button
              type="button"
              key={item.id}
              onClick={() =>
                setHost((previous) => removeItem(previous, item.id))
              }
            >
              Remove {item.label}
            </button>
          ))}
        </div>
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
