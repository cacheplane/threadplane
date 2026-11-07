'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  advancePlayback,
  frameAt,
  seek,
  startPlayback,
  type Playback,
  type Recording,
} from './playback';
import { StateTree } from './StateTree';
import tripRecording from './trip-recording.json';
import './workbench.css';

const modes = ['Messages', 'Events', 'State', 'Requests'] as const;
type Mode = (typeof modes)[number];
const sourceRoot =
  'https://github.com/cacheplane/threadplane/blob/main/cockpit/langgraph/streaming';

/** Read-only recording viewer: no session, transport, or command references. */
export function LearningWorkbench({
  framework,
  recording = tripRecording as Recording,
}: {
  readonly framework: 'angular' | 'react';
  readonly recording?: Recording;
}) {
  const id = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const [playback, setPlayback] = useState<Playback>({
    cursor: 0,
    playing: false,
  });
  const [mode, setMode] = useState<Mode>('State');
  const [stateView, setStateView] = useState<'Tree' | 'JSON'>('Tree');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [requestId, setRequestId] = useState<string | null>(null);
  const count = recording.frames.length;
  const cursor = seek(playback.cursor, count);
  const frame = frameAt(recording.frames, cursor);
  useEffect(() => {
    const pane = conversationRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [frame]);
  // A different recording must never inherit an active timer or stale selection.
  useEffect(() => {
    setPlayback({ cursor: 0, playing: false });
    setExpanded(new Set());
    setRequestId(null);
  }, [recording]);
  useEffect(() => {
    if (!playback.playing) return;
    const timer = window.setInterval(
      () => setPlayback((current) => advancePlayback(current, count)),
      800
    );
    return () => window.clearInterval(timer);
  }, [playback.playing, count]);

  function goTo(next: number) {
    setPlayback({ cursor: seek(next, count), playing: false });
  }
  function togglePath(path: string) {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  const requests = frame?.requests ?? [];
  const request =
    requests.find((item) => item.id === requestId) ??
    requests[requests.length - 1];
  const frameworkName = framework === 'react' ? 'React' : 'Angular';
  const source =
    framework === 'react'
      ? 'react/src/app.tsx'
      : 'angular/src/app/streaming.component.ts';

  return (
    <section
      className="tp-learn not-prose"
      aria-label="Streaming learning workbench"
    >
      <header className="tp-learn-header">
        <div>
          <span className="tp-learn-eyebrow">THREADPLANE / WORKBENCH 01</span>
          <h3>A trip, one observation at a time.</h3>
        </div>
        <span className="tp-learn-badge">Fixture replay</span>
      </header>
      <div className="tp-learn-body">
        <section
          className="tp-learn-conversation"
          aria-label="Trip conversation"
        >
          <div className="tp-learn-pane-heading">
            <strong>Trip notebook</strong>
            <span className="tp-learn-dim">Streamed response</span>
          </div>
          <div
            className="tp-learn-conversation-scroll"
            ref={conversationRef}
            tabIndex={0}
            role="region"
            aria-label="Recorded conversation messages"
          >
            <div className="tp-learn-trip">
              <span className="tp-learn-eyebrow">THE LEARNING APP</span>
              <h4>A little time in Paris.</h4>
              <p>
                Follow a traveler’s prompt as a response arrives. Pause to see
                what the application knows.
              </p>
            </div>
            {frame?.messages.length ? (
              frame.messages.map((message) => (
                <article
                  className={`tp-learn-message ${
                    message.role === 'user' || message.role === 'human'
                      ? 'tp-learn-message-user'
                      : ''
                  }`}
                  key={message.id}
                >
                  <span className="tp-learn-eyebrow">
                    {message.role === 'user' || message.role === 'human'
                      ? 'You'
                      : message.role}
                  </span>
                  <p>{message.text || 'No text observed yet.'}</p>
                </article>
              ))
            ) : (
              <p className="tp-learn-empty">
                Press Play to follow the recorded conversation, or move through
                it one observation at a time.
              </p>
            )}
          </div>
          <div className="tp-learn-conversation-note">
            Read-only playback · no requests are sent
          </div>
        </section>
        <section className="tp-learn-inspector" aria-label="Inspector">
          <div className="tp-learn-pane-heading">
            <strong>Inspector</strong>
            <span className="tp-learn-dim">At the playhead</span>
          </div>
          <div
            className="tp-learn-modes"
            role="group"
            aria-label="Inspector view"
          >
            {modes.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={mode === item}
                aria-controls={`${id}-panel`}
                onClick={() => setMode(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel`}
            className="tp-learn-inspector-scroll"
            role="region"
            aria-label={`${mode} inspection`}
            tabIndex={0}
          >
            {mode === 'State' && (
              <>
                <div className="tp-learn-inspector-heading">
                  <span>Application state</span>
                  <div
                    role="group"
                    aria-label="State format"
                    className="tp-learn-segment"
                  >
                    {(['Tree', 'JSON'] as const).map((item) => (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={stateView === item}
                        onClick={() => setStateView(item)}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                </div>
                <p className="tp-learn-help">
                  Observed application fields, not the provider’s internal
                  state.
                </p>
                {frame?.state == null ? (
                  <p className="tp-learn-empty">
                    State has not been observed at this point.
                  </p>
                ) : stateView === 'JSON' ? (
                  <pre aria-label="Application state JSON">
                    {JSON.stringify(frame.state, null, 2)}
                  </pre>
                ) : (
                  <StateTree
                    value={frame.state}
                    expanded={expanded}
                    onToggle={togglePath}
                  />
                )}
              </>
            )}
            {mode === 'Messages' && (
              <>
                <div className="tp-learn-inspector-heading">
                  <span>Observed messages</span>
                  <span className="tp-learn-dim">
                    {frame?.messages.length ?? 0}
                  </span>
                </div>
                {frame?.messages.length ? (
                  <pre aria-label="Messages JSON">
                    {JSON.stringify(frame.messages, null, 2)}
                  </pre>
                ) : (
                  <p className="tp-learn-empty">No messages observed yet.</p>
                )}
              </>
            )}
            {mode === 'Events' && (
              <>
                <p className="tp-learn-help">
                  Select an observation to move the whole workbench to that
                  point.
                </p>
                <ol className="tp-learn-events">
                  {recording.frames.map((item, index) => (
                    <li key={item.id}>
                      <button
                        type="button"
                        aria-label={`${index + 1}. ${
                          item.label
                        }, ${item.elapsedMs.toFixed(0)} milliseconds`}
                        aria-current={cursor === index ? 'step' : undefined}
                        onClick={() => goTo(index)}
                      >
                        <span className="tp-learn-event-index">
                          {index + 1}.
                        </span>
                        <span>
                          {item.label}
                          <small>{item.event.type}</small>
                        </span>
                        <span className="tp-learn-dim">
                          {item.elapsedMs.toFixed(0)} ms
                        </span>
                      </button>
                    </li>
                  ))}
                </ol>
                {frame && (
                  <details className="tp-learn-event-detail">
                    <summary>Selected event payload</summary>
                    <pre>{JSON.stringify(frame.event.payload, null, 2)}</pre>
                  </details>
                )}
              </>
            )}
            {mode === 'Requests' && (
              <>
                <p className="tp-learn-help">
                  Application HTTP requests to the fixture server. Provider
                  requests were not captured.
                </p>
                {!request ? (
                  <p className="tp-learn-empty">
                    No requests observed at this point.
                  </p>
                ) : (
                  <>
                    <label
                      className="tp-learn-request-picker"
                      htmlFor={`${id}-request`}
                    >
                      Observed request
                      <select
                        id={`${id}-request`}
                        value={request.id}
                        onChange={(event) => setRequestId(event.target.value)}
                      >
                        {requests.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.method} {item.path}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="tp-learn-request-status">
                      {request.status === null
                        ? 'Response not yet observed'
                        : `HTTP ${request.status}`}
                    </div>
                    <span className="tp-learn-eyebrow">
                      Captured request body
                    </span>
                    <pre aria-label="Request body">
                      {JSON.stringify(request.body, null, 2)}
                    </pre>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      </div>
      <footer className="tp-learn-playback">
        <div className="tp-learn-controls">
          <button
            className="tp-learn-play"
            type="button"
            disabled={count < 2}
            aria-label={
              playback.playing
                ? 'Pause recording'
                : cursor === count - 1
                ? 'Replay recording'
                : 'Play recording'
            }
            onClick={() =>
              setPlayback((current) =>
                current.playing
                  ? { ...current, playing: false }
                  : startPlayback(current.cursor, count)
              )
            }
          >
            {playback.playing
              ? 'Pause'
              : cursor === count - 1
              ? 'Replay'
              : 'Play'}
          </button>
          <button
            type="button"
            aria-label="Previous observation"
            disabled={cursor === 0}
            onClick={() => goTo(cursor - 1)}
          >
            ←
          </button>
          <button
            type="button"
            aria-label="Next observation"
            disabled={!count || cursor === count - 1}
            onClick={() => goTo(cursor + 1)}
          >
            →
          </button>
          <label className="tp-learn-timeline" htmlFor={`${id}-timeline`}>
            <span className="tp-learn-sr-only">Observation</span>
            <input
              id={`${id}-timeline`}
              type="range"
              min={0}
              max={Math.max(0, count - 1)}
              step={1}
              value={cursor}
              disabled={count < 2}
              aria-valuetext={`${count ? cursor + 1 : 0} of ${count}: ${
                frame?.label ?? 'Empty recording'
              }`}
              onChange={(event) => goTo(Number(event.target.value))}
            />
          </label>
          <span className="tp-learn-count">
            {count ? cursor + 1 : 0} / {count}
          </span>
        </div>
        <div className="tp-learn-playback-caption">
          <span aria-live={playback.playing ? 'off' : 'polite'}>
            {frame?.label ?? 'No observations available'}
          </span>
          <span>Reading pace · 0.8s per observation</span>
        </div>
      </footer>
      <div className="tp-learn-provenance">
        <details>
          <summary>About this recording</summary>
          <p>{recording.provenance.description}</p>
          <p>
            Observation times are capture offsets. Playback is slowed for
            reading; it does not measure model performance.
          </p>
          <p>
            <a
              href={`https://github.com/cacheplane/threadplane/blob/main/${recording.provenance.source}`}
            >
              Recording source
            </a>
          </p>
        </details>
        <a href={`${sourceRoot}/${source}`}>{frameworkName} source</a>
      </div>
    </section>
  );
}
