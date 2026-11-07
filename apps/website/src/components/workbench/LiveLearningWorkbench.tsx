'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import {
  RunMode,
  RuntimeTargetSettings,
  useEmbeddedRuntimeController,
  useRuntimeTargetView,
} from '@threadplane/workspace-react';
import { LearningWorkbench } from './LearningWorkbench';
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
  return (
    <div className="tp-learn-host">
      <div
        className="tp-learn-session-controls"
        role="group"
        aria-label="Workbench session"
      >
        <button
          type="button"
          aria-pressed={mode === 'replay'}
          disabled={busy}
          onClick={() => setMode('replay')}
        >
          Replay
        </button>
        <button
          type="button"
          aria-pressed={mode === 'live'}
          disabled={!props.runtimeUrl}
          onClick={() => setMode('live')}
        >
          Live
        </button>
        <span>
          {busy
            ? 'A call is active. You can still inspect its history.'
            : 'Replay the example or try your own conversation.'}
        </span>
      </div>
      {!props.runtimeUrl && (
        <p className="tp-learn-runtime-note">
          Live inspection is unavailable for this runtime.
        </p>
      )}
      {mode === 'replay' ? (
        <LearningWorkbench framework={props.framework} />
      ) : (
        <LiveSession {...props} onBusy={setBusy} />
      )}
    </div>
  );
}

function LiveSession({
  framework,
  runtimeUrl,
  capability,
  onBusy,
}: Props & { onBusy(busy: boolean): void }) {
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
