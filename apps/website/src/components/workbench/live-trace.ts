import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import type { Recording } from './playback';

export interface LiveTrace {
  readonly frames: readonly InspectionFrame[];
  /** null follows the latest observation; a number selects a stable sequence. */
  readonly cursor: number | null;
  readonly bytes: number;
  readonly dropped: number;
  readonly expired: boolean;
}
export function createLiveTrace(): LiveTrace {
  return { frames: [], cursor: null, bytes: 0, dropped: 0, expired: false };
}
const size = (frame: InspectionFrame) =>
  new TextEncoder().encode(JSON.stringify(frame)).length;

export function appendObservation(
  trace: LiveTrace,
  frame: InspectionFrame
): LiveTrace {
  if (frame.sequence <= (trace.frames.at(-1)?.sequence ?? -1)) return trace;
  const frames = [...trace.frames, frame];
  let bytes = trace.bytes + size(frame);
  let dropped = trace.dropped;
  while (frames.length > 200 || bytes > 2 * 1024 * 1024) {
    bytes -= size(frames.shift()!);
    dropped++;
  }
  const expired =
    trace.cursor !== null &&
    !frames.some((item) => item.sequence === trace.cursor);
  return {
    frames,
    bytes,
    dropped,
    cursor: expired ? frames[0]?.sequence ?? null : trace.cursor,
    expired: trace.expired || expired,
  };
}
export function selectObservation(
  trace: LiveTrace,
  sequence: number
): LiveTrace {
  return trace.frames.some((frame) => frame.sequence === sequence)
    ? { ...trace, cursor: sequence, expired: false }
    : trace;
}
export function returnToLive(trace: LiveTrace): LiveTrace {
  return { ...trace, cursor: null, expired: false };
}
export function liveRecording(trace: LiveTrace): Recording {
  return {
    version: 1,
    provenance: {
      kind: 'live',
      source: 'Selected framework streaming application',
      description:
        'Observations from the running application in this browser session. Application calls show submit inputs and settlement, not HTTP or provider requests. Settled means the invocation returned; inspect application state for its outcome.',
    },
    frames: trace.frames.map((frame) => ({
      id: String(frame.sequence),
      label: frame.event.type,
      elapsedMs: frame.elapsedMs,
      messages: frame.messages,
      state: frame.state,
      requests: [],
      calls: frame.calls,
      event: frame.event,
    })),
  };
}
