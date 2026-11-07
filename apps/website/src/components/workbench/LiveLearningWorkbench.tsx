'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import {
  RunMode,
  RuntimeTargetSettings,
  useEmbeddedRuntimeController,
  useRuntimeTargetView,
} from '@threadplane/workspace-react';
import {
  LearningWorkbench,
  type LearningWorkbenchPresentation,
} from './LearningWorkbench';
import { useWorkbenchLayout } from './use-workbench-layout';
import { learningMilestones, type LearningSource } from './learning-lesson';
import tripRecording from './trip-recording.json';
import type { Recording } from './playback';
import {
  appendObservation,
  createLiveTrace,
  liveRecording,
  returnToLive,
  selectObservation,
} from './live-trace';

interface Props {
  readonly framework: 'angular' | 'react';
  readonly runtimeUrl: string | null;
  readonly capability: string;
  readonly source?: LearningSource;
}
// No analytics token is passed to the embedded learning application.
const getSessionId = () => 'learning-workbench';

export function LiveLearningWorkbench(props: Props) {
  return (
    <WorkbenchSession
      key={`${props.framework}:${props.runtimeUrl}:${props.capability}`}
      {...props}
    />
  );
}

function WorkbenchSession(props: Props) {
  const [mode, setMode] = useState<'replay' | 'live'>('replay');
  const [busy, setBusy] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [sourceFocusRequest, setSourceFocusRequest] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [seekRequest, setSeekRequest] = useState<{
    id: number;
    index: number;
  }>();
  const host = useRef<HTMLDivElement>(null);
  const sourceOpener = useRef<HTMLButtonElement | null>(null);
  const sourceRegionId = `${useId()}-source`;
  function openSource(opener: HTMLButtonElement) {
    sourceOpener.current = opener;
    setSourceOpen(true);
    setSourceFocusRequest((value) => value + 1);
  }
  function closeSource() {
    setSourceOpen(false);
    sourceOpener.current?.focus();
  }
  const layoutControls = useWorkbenchLayout();
  const frameworkName = props.framework === 'react' ? 'React' : 'Angular';
  const sessionControls = (
    <div className="tp-learn-example-controls">
      <div
        className="tp-learn-session-controls"
        role="group"
        aria-label="Example session"
      >
        <span className="tp-learn-session-label">Example session</span>
        <button
          type="button"
          aria-pressed={mode === 'replay'}
          disabled={busy}
          onClick={() => {
            setMode('replay');
            setSourceOpen(false);
          }}
        >
          Recorded example
        </button>
        <button
          type="button"
          aria-pressed={mode === 'live'}
          disabled={!props.runtimeUrl}
          onClick={() => {
            setMode('live');
            setSourceOpen(false);
          }}
        >
          Live conversation
        </button>
      </div>
      {props.source && (
        <button
          type="button"
          className="tp-learn-source-action"
          aria-expanded={sourceOpen}
          aria-controls={sourceRegionId}
          onClick={(event) =>
            sourceOpen ? closeSource() : openSource(event.currentTarget)
          }
        >
          View example source
        </button>
      )}
      {busy && (
        <p className="tp-learn-session-status">
          A call is active. You can still inspect its history.
        </p>
      )}
    </div>
  );
  const presentation: LearningWorkbenchPresentation = {
    source: props.source,
    sourceOpen,
    sourceFocusRequest,
    sourceRegionId,
    onCloseSource: closeSource,
    sourceReturnLabel:
      mode === 'replay'
        ? 'Return to recorded example'
        : 'Return to live conversation',
    sessionControls,
    layoutControls,
    expanded,
    seekRequest,
    onToggleExpanded: () => setExpanded((value) => !value),
    onResetLayout: () => {
      layoutControls.reset();
      setExpanded(false);
    },
  };
  return (
    <div
      ref={host}
      className="tp-learn-host"
      data-expanded={expanded || undefined}
    >
      {!props.runtimeUrl && (
        <p className="tp-learn-runtime-note">
          Live inspection is unavailable for this runtime.
        </p>
      )}
      {mode === 'replay' ? (
        <LearningWorkbench framework={props.framework} {...presentation} />
      ) : (
        <LiveSession {...props} onBusy={setBusy} presentation={presentation} />
      )}
      {props.source && (
        <section
          className="tp-learn-teaching"
          aria-label="Connect observations to source"
        >
          <div className="tp-learn-explanation">
            <h3>Partial text is an observation.</h3>
            <p>
              The view can show part of an answer while the application is still
              busy. Completion is separate: compare <code>busy</code> with{' '}
              <code>outcome</code> at the final observation.
            </p>
            <div className="tp-learn-snippet">
              <div className="tp-learn-snippet-heading">
                <span>
                  {props.source.snippet.path.split('/').at(-1)} · observe the
                  application
                </span>
                <div>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const moment = learningMilestones(
                        tripRecording as Recording
                      ).find((item) => item.id === 'partial');
                      if (!moment) return;
                      setMode('replay');
                      setSourceOpen(false);
                      setSeekRequest((previous) => ({
                        id: (previous?.id ?? 0) + 1,
                        index: moment.index,
                      }));
                      host.current?.scrollIntoView({
                        block: 'start',
                        behavior: 'smooth',
                      });
                    }}
                  >
                    See it run
                  </button>
                  <button
                    type="button"
                    aria-expanded={sourceOpen}
                    aria-controls={sourceRegionId}
                    onClick={(event) => {
                      openSource(event.currentTarget);
                      host.current?.scrollIntoView({
                        block: 'start',
                        behavior: 'smooth',
                      });
                    }}
                  >
                    View source
                  </button>
                </div>
              </div>
              <pre>
                <code>{props.source.snippet.code}</code>
              </pre>
            </div>
          </div>
          <aside className="tp-learn-related">
            <h4>Explore the implementation</h4>
            <p>
              This guide’s example session and source stay here. Use the page’s
              Docs, Run, Code, and API controls to explore the complete project.
            </p>
            <a href={`/docs/${props.framework}/langgraph/guides/streaming`}>
              Open {frameworkName} streaming example
            </a>
          </aside>
        </section>
      )}
    </div>
  );
}

function LiveSession({
  framework,
  runtimeUrl,
  capability,
  onBusy,
  presentation,
}: Props & {
  onBusy(busy: boolean): void;
  presentation: LearningWorkbenchPresentation;
}) {
  const [trace, setTrace] = useState(createLiveTrace);
  const target = useRuntimeTargetView('langgraph');
  const onInspection = useCallback(
    (frame: InspectionFrame) => {
      if (frame.framework === framework)
        setTrace((current) => appendObservation(current, frame));
    },
    [framework]
  );
  const onInspectionReset = useCallback(() => setTrace(createLiveTrace()), []);
  const controller = useEmbeddedRuntimeController({
    runtimeUrl,
    capability,
    adapter: 'langgraph',
    onInspection,
    onInspectionReset,
  });
  const latest = trace.frames.at(-1);
  const busy = Boolean(
    latest?.busy || latest?.calls.some((call) => call.status === 'pending')
  );
  useEffect(() => {
    onBusy(busy);
  }, [busy, onBusy]);
  const recording = useMemo(() => liveRecording(trace), [trace]);
  const cursor =
    trace.cursor === null
      ? Math.max(0, trace.frames.length - 1)
      : Math.max(
          0,
          trace.frames.findIndex((frame) => frame.sequence === trace.cursor)
        );
  const phase = controller.snapshot.phase;
  const failure = [
    'error',
    'unresponsive',
    'unauthorized',
    'network_blocked',
    'incompatible_bridge',
    'invalid_configuration',
    'not_configured',
  ].includes(phase);
  const notice = [
    trace.dropped
      ? `${trace.dropped} older observations were removed to keep this session bounded.`
      : '',
    trace.expired
      ? 'Your selected observation expired; the earliest retained observation is shown.'
      : '',
    latest?.limited
      ? 'Some captured fields or text were omitted or shortened to fit the observation limit.'
      : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <div className="tp-learn-runtime-note">
        <span>
          {target.kind === 'shared'
            ? 'Shared development target'
            : 'Your custom LangGraph target'}{' '}
          · {framework === 'react' ? 'React' : 'Angular'}
        </span>
        <p>
          Send a prompt in the application. Changing the target starts a fresh
          live session.
        </p>
        <details className="tp-learn-target-settings">
          <summary>Runtime settings</summary>
          <RuntimeTargetSettings
            adapter="langgraph"
            runtimeOrigin={
              controller.validatedRuntimeUrl
                ? new URL(controller.validatedRuntimeUrl).origin
                : null
            }
          />
        </details>
        {failure ? (
          <p role="status">
            Live runtime: {phase.replaceAll('_', ' ')}. Check the runtime
            settings and reload to retry.
          </p>
        ) : !latest ? (
          <p role="status">
            Waiting for live observations. The selected runtime must include
            inspection support.
          </p>
        ) : null}
        <button
          type="button"
          disabled={busy && !failure}
          onClick={controller.reload}
        >
          Reload live app
        </button>
      </div>
      <LearningWorkbench
        {...presentation}
        framework={framework}
        recording={recording}
        live={{
          cursor,
          following: trace.cursor === null,
          notice,
          onSeek: (index) => {
            const frame = trace.frames[index];
            if (frame)
              setTrace((current) => selectObservation(current, frame.sequence));
          },
          onReturn: () => setTrace(returnToLive),
          conversation: (
            <RunMode
              entryTitle={`${
                framework === 'react' ? 'React' : 'Angular'
              } streaming`}
              runtimeUrl={controller.validatedRuntimeUrl}
              capabilitySlug={capability}
              frameRef={controller.frameRef}
              frameGeneration={controller.frameGeneration}
              targetGeneration={controller.targetGeneration}
              onFrameLoad={controller.onFrameLoad}
              runtimePhase={phase}
              getSessionId={getSessionId}
            />
          ),
        }}
      />
    </>
  );
}
