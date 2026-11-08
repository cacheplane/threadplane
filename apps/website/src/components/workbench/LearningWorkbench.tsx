'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
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
import { WorkbenchSeparator } from './WorkbenchSeparator';
import { useWorkbenchLayout } from './use-workbench-layout';
import { LearningSourceView } from './LearningSourceView';
import {
  learningMilestones,
  sourceHref,
  type LearningMilestone,
  type LearningMoment,
  type LearningSource,
} from './learning-lesson';
import {
  GuidedReplayLesson,
  GuidedReplayExplanation,
  GuidedReplayNavigation,
} from './GuidedReplayLesson';
import { guidedLesson } from './guided-lesson';
import { DEFAULT_WORKBENCH_LAYOUT } from './workbench-layout';
import './guided-workbench.css';

export interface LearningWorkbenchPresentation {
  readonly source?: LearningSource;
  readonly sourceOpen?: boolean;
  readonly sourceFocusRequest?: number;
  readonly sourceRegionId?: string;
  readonly onCloseSource?: () => void;
  readonly sourceReturnLabel?: string;
  readonly sessionControls?: ReactNode;
  readonly layoutControls?: ReturnType<typeof useWorkbenchLayout>;
  readonly expanded?: boolean;
  readonly onToggleExpanded?: () => void;
  readonly onResetLayout?: () => void;
  readonly seekRequest?: { readonly id: number; readonly index: number };
}

const modes = ['Messages', 'Events', 'State', 'Requests'] as const;
type Mode = (typeof modes)[number];
const sourceRoot =
  'https://github.com/cacheplane/threadplane/blob/main/cockpit/langgraph/streaming';

/** The inspector seeks observations; only the separately owned live app submits. */
export function LearningWorkbench({
  framework,
  recording = tripRecording as Recording,
  live,
  source: lessonSource,
  sourceOpen = false,
  sourceFocusRequest,
  sourceRegionId,
  onCloseSource,
  sourceReturnLabel,
  sessionControls,
  layoutControls,
  expanded: workbenchExpanded,
  onToggleExpanded,
  onResetLayout,
  seekRequest,
}: {
  readonly framework: 'angular' | 'react';
  readonly recording?: Recording;
  readonly live?: {
    readonly cursor: number;
    readonly following: boolean;
    readonly onSeek: (index: number) => void;
    readonly onReturn: () => void;
    readonly conversation: ReactNode;
    readonly notice?: string;
  };
} & LearningWorkbenchPresentation) {
  const id = useId();
  const sourceRef = useRef<HTMLElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const ownLayout = useWorkbenchLayout();
  const { layout, update, reset } = layoutControls ?? ownLayout;
  const lesson = useMemo(() => guidedLesson(recording), [recording]);
  const guided = !live && lesson.userIndex !== undefined;
  const initialCursor = guided ? lesson.userIndex ?? 0 : 0;
  const [dataOpen, setDataOpen] = useState(false);
  const [playback, setPlayback] = useState<Playback>({
    cursor: initialCursor,
    playing: false,
  });
  const [mode, setMode] = useState<Mode>('State');
  const [selectedMoment, setSelectedMoment] = useState<LearningMoment | null>(
    guided ? 'message' : null
  );
  const [stateView, setStateView] = useState<'Tree' | 'JSON'>('Tree');
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [requestId, setRequestId] = useState<string | null>(null);
  const count = recording.frames.length;
  const isLive = live !== undefined;
  const cursor = seek(live?.cursor ?? playback.cursor, count);
  const frame = frameAt(recording.frames, cursor);
  // Background live capture must not disturb a reader's historical scroll.
  const conversationIdentity = isLive ? frame?.id : frame;
  useEffect(() => {
    if (sourceOpen) sourceRef.current?.focus({ preventScroll: true });
  }, [sourceOpen, sourceFocusRequest]);
  useEffect(() => {
    const pane = conversationRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [conversationIdentity]);
  // A different recording must never inherit an active timer or stale selection.
  useEffect(() => {
    if (isLive) return;
    setPlayback({ cursor: lesson.userIndex ?? 0, playing: false });
    setSelectedMoment(lesson.userIndex === undefined ? null : 'message');
    setMode(lesson.userIndex === undefined ? 'State' : 'Messages');
    setDataOpen(false);
    setExpanded(new Set());
    setRequestId(null);
  }, [recording, isLive, lesson]);
  useEffect(() => {
    if (seekRequest && !isLive) {
      setPlayback({ cursor: seek(seekRequest.index, count), playing: false });
      setSelectedMoment(null);
    }
  }, [seekRequest, count, isLive]);
  useEffect(() => {
    if (sourceOpen && !isLive)
      setPlayback((current) => ({ ...current, playing: false }));
  }, [sourceOpen, isLive]);
  useEffect(() => {
    if (isLive || !playback.playing) return;
    const timer = window.setInterval(
      () => setPlayback((current) => advancePlayback(current, count)),
      800
    );
    return () => window.clearInterval(timer);
  }, [playback.playing, count, isLive]);

  function goTo(next: number) {
    setSelectedMoment(null);
    if (live) {
      live.onSeek(seek(next, count));
      return;
    }
    setPlayback({ cursor: seek(next, count), playing: false });
  }
  function selectMoment(
    moment: LearningMilestone,
    inspector: 'Messages' | 'State'
  ) {
    goTo(moment.index);
    setSelectedMoment(moment.id);
    setMode(inspector);
  }
  function restartLesson() {
    const first = lesson.moments.find((moment) => moment.id === 'message');
    if (first) selectMoment(first, 'Messages');
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
  const calls = frame?.calls ?? [];
  const call = calls.find((item) => item.id === requestId) ?? calls.at(-1);
  const request =
    requests.find((item) => item.id === requestId) ??
    requests[requests.length - 1];
  const frameworkName = framework === 'react' ? 'React' : 'Angular';
  const source =
    framework === 'react'
      ? 'react/src/app.tsx'
      : 'angular/src/app/streaming.component.ts';

  const inspector = (
    <section className="tp-learn-inspector" aria-label="Inspector">
      <div className="tp-learn-pane-heading">
        <strong>Inspector</strong>
        <span className="tp-learn-dim">At the playhead</span>
      </div>
      <div className="tp-learn-modes" role="group" aria-label="Inspector view">
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
              Observed application fields, not the provider’s internal state.
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
              Select an observation to move the whole workbench to that point.
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
                    <span className="tp-learn-event-index">{index + 1}.</span>
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
            {live ? (
              <>
                <div className="tp-learn-inspector-heading">
                  Application calls
                </div>
                <p className="tp-learn-help">
                  Observed submit inputs and settlement. Settled means the
                  invocation returned; read State for its outcome. HTTP and
                  provider requests are not captured here.
                </p>
                {call ? (
                  <>
                    <label
                      className="tp-learn-request-picker"
                      htmlFor={`${id}-call`}
                    >
                      Observed call
                      <select
                        id={`${id}-call`}
                        value={call.id}
                        onChange={(event) => setRequestId(event.target.value)}
                      >
                        {calls.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {item.id}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="tp-learn-request-status">
                      Application call {call.status}
                    </div>
                    <span className="tp-learn-eyebrow">
                      Captured submit input
                    </span>
                    <pre aria-label="Application call input">
                      {JSON.stringify(call.input, null, 2)}
                    </pre>
                  </>
                ) : (
                  <p className="tp-learn-empty">
                    No calls observed at this point.
                  </p>
                )}
              </>
            ) : (
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
          </>
        )}
      </div>
    </section>
  );

  return (
    <section
      className="tp-learn not-prose"
      data-guided={guided || undefined}
      aria-label="Streaming learning workbench"
      style={
        {
          '--learn-chat': `${layout.split}fr`,
          '--learn-inspector': `${100 - layout.split}fr`,
          '--learn-height': `${layout.height}px`,
        } as CSSProperties
      }
    >
      <header className="tp-learn-header">
        <div>
          <h3>{guided ? 'Follow one turn' : 'Watch a turn unfold.'}</h3>
        </div>
        <div className="tp-learn-header-actions">
          {guided && (
            <button
              type="button"
              className="tp-learn-restart"
              onClick={restartLesson}
            >
              Restart lesson
            </button>
          )}
          <span className="tp-learn-badge">
            {sourceOpen
              ? 'Lesson source'
              : live
              ? live.following
                ? 'Following live'
                : 'Live history'
              : 'Fixture replay'}
          </span>
          {onToggleExpanded && (
            <button
              type="button"
              aria-label={
                workbenchExpanded
                  ? 'Restore workbench width'
                  : 'Expand workbench'
              }
              aria-pressed={workbenchExpanded}
              onClick={onToggleExpanded}
            >
              {workbenchExpanded ? 'Restore width' : 'Expand'}
            </button>
          )}
        </div>
      </header>
      {!guided && sessionControls}
      {lessonSource && (
        <section
          id={sourceRegionId ?? `${id}-source`}
          ref={sourceRef}
          aria-label="Example source"
          tabIndex={-1}
          hidden={!sourceOpen}
          inert={!sourceOpen}
        >
          {onCloseSource && (
            <div className="tp-learn-source-return">
              <button type="button" onClick={onCloseSource}>
                {sourceReturnLabel ?? 'Return to example session'}
              </button>
            </div>
          )}
          <LearningSourceView
            source={lessonSource}
            visible={sourceOpen}
            focusRequest={sourceFocusRequest}
            filesWidth={layout.files}
            onFilesWidth={(files, persist) => update({ files }, persist)}
          />
        </section>
      )}
      <div
        hidden={sourceOpen}
        inert={sourceOpen}
        className="tp-learn-observation-view"
      >
        {!live && (
          <GuidedReplayLesson
            recording={recording}
            cursor={cursor}
            selectedMoment={selectedMoment}
            lesson={lesson}
            onSelect={selectMoment}
          />
        )}
        <div className="tp-learn-body" ref={bodyRef}>
          <section
            className="tp-learn-conversation"
            aria-label="Trip conversation"
          >
            <div className="tp-learn-pane-heading">
              <strong>Trip notebook</strong>
              <span className="tp-learn-dim">
                {live ? `${frameworkName} application` : 'Streamed response'}
              </span>
            </div>
            {live && (
              <div
                className="tp-learn-live-frame"
                hidden={!live.following}
                inert={!live.following}
              >
                {live.conversation}
              </div>
            )}
            <div
              className="tp-learn-conversation-scroll"
              ref={conversationRef}
              tabIndex={0}
              role="region"
              aria-label="Recorded conversation messages"
              hidden={live?.following}
            >
              <div className="tp-learn-trip">
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
                    data-message-id={message.id}
                  >
                    <span className="tp-learn-eyebrow">
                      {message.role === 'user' || message.role === 'human'
                        ? 'You'
                        : message.role}
                    </span>
                    <p>
                      {(isLive
                        ? message.text
                        : message.text.replace(/\\n/g, '\n')) ||
                        'No text observed yet.'}
                    </p>
                  </article>
                ))
              ) : (
                <p className="tp-learn-empty">
                  {live
                    ? 'No messages observed at this point.'
                    : 'Press Play to follow the recorded conversation, or move through it one observation at a time.'}
                </p>
              )}
            </div>
            <div className="tp-learn-conversation-note">
              {live?.following
                ? 'The live application owns your actions'
                : 'Read-only playback · no requests are sent'}
            </div>
          </section>
          <WorkbenchSeparator
            label={
              guided
                ? 'Resize conversation and explanation'
                : 'Resize conversation and inspector'
            }
            orientation="vertical"
            value={layout.split}
            min={25}
            max={75}
            step={4}
            defaultValue={44}
            onChange={(split, persist) => update({ split }, persist)}
            valueFromPointer={(event) => {
              const bounds = bodyRef.current?.getBoundingClientRect();
              return bounds && bounds.width > 0
                ? ((event.clientX - bounds.left) / bounds.width) * 100
                : layout.split;
            }}
          />
          {guided ? (
            <GuidedReplayExplanation
              lesson={lesson}
              recording={recording}
              cursor={cursor}
              selectedMoment={selectedMoment}
              onSelect={selectMoment}
              onSeek={goTo}
            />
          ) : (
            inspector
          )}
        </div>
        <WorkbenchSeparator
          label="Resize workbench height"
          orientation="horizontal"
          value={layout.height}
          min={360}
          max={800}
          step={20}
          defaultValue={DEFAULT_WORKBENCH_LAYOUT.height}
          className="tp-learn-height-separator"
          onChange={(height, persist) => update({ height }, persist)}
          valueFromPointer={(event) =>
            event.clientY -
            (bodyRef.current?.getBoundingClientRect().top ?? event.clientY)
          }
        />
        {guided && (
          <GuidedReplayNavigation
            lesson={lesson}
            recording={recording}
            cursor={cursor}
            selectedMoment={selectedMoment}
            onSelect={selectMoment}
          />
        )}
        <div className={guided ? 'tp-learn-data-tools' : undefined}>
          {guided && (
            <button
              type="button"
              aria-expanded={dataOpen}
              aria-controls={`${id}-data`}
              onClick={() => setDataOpen((open) => !open)}
            >
              {dataOpen ? 'Hide data' : 'Inspect data'}
            </button>
          )}
          <div
            id={`${id}-data`}
            hidden={guided && !dataOpen}
            inert={guided && !dataOpen}
          >
            {guided && inspector}
            <footer className="tp-learn-playback">
              {live?.notice && (
                <p className="tp-learn-help" role="status">
                  {live.notice}
                </p>
              )}
              <div className="tp-learn-controls">
                {live ? (
                  <button
                    type="button"
                    className="tp-learn-play"
                    disabled={live.following}
                    onClick={live.onReturn}
                  >
                    Return to live
                  </button>
                ) : (
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
                    onClick={() => {
                      setSelectedMoment(null);
                      setPlayback((current) =>
                        current.playing
                          ? { ...current, playing: false }
                          : startPlayback(current.cursor, count)
                      );
                    }}
                  >
                    {playback.playing
                      ? 'Pause'
                      : cursor === count - 1
                      ? 'Replay'
                      : 'Play'}
                  </button>
                )}
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
              {live && (
                <div
                  className="tp-learn-milestones"
                  role="group"
                  aria-label="Lesson moments"
                >
                  {learningMilestones(recording).map((moment) => (
                    <button
                      key={moment.id}
                      type="button"
                      aria-current={
                        cursor === moment.index ? 'step' : undefined
                      }
                      onClick={() => goTo(moment.index)}
                    >
                      {moment.label}
                    </button>
                  ))}
                </div>
              )}
              <div className="tp-learn-playback-caption">
                <span aria-live={playback.playing ? 'off' : 'polite'}>
                  {frame?.label ?? 'No observations available'}
                </span>
                <span>
                  {live
                    ? live.following
                      ? 'Following incoming observations'
                      : 'History is read-only; capture continues'
                    : 'Reading pace · 0.8s per observation'}
                </span>
              </div>
            </footer>
          </div>
        </div>
      </div>
      {guided && sessionControls}
      <div className="tp-learn-provenance">
        <details>
          <summary>
            {live ? 'About live inspection' : 'About this recording'}
          </summary>
          <p>{recording.provenance.description}</p>
          <p>
            Observation times are capture offsets. Playback is slowed for
            reading; it does not measure model performance.
          </p>
          {!live && (
            <p>
              <a
                href={`https://github.com/cacheplane/threadplane/blob/main/${recording.provenance.source}`}
              >
                Recording source
              </a>
            </p>
          )}
        </details>
        <a
          href={
            lessonSource
              ? sourceHref(
                  lessonSource.revision,
                  lessonSource.snippet.path,
                  lessonSource.snippet
                )
              : `${sourceRoot}/${source}`
          }
        >
          {frameworkName} source
        </a>
        <button type="button" onClick={onResetLayout ?? reset}>
          Reset layout
        </button>
      </div>
    </section>
  );
}
