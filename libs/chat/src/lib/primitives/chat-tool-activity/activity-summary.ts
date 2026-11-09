import { activityProgress } from './tool-outcome';
import type {
  ToolActivityInfo,
  ToolActivityPhase,
} from './chat-tool-activity.component';

/** Readonly presentation evidence; literal results never establish state. */
export function activitySummary(
  activities: readonly ToolActivityInfo[],
  caption?: string
): {
  readonly label: string;
  readonly cue: string;
  readonly active: boolean;
  readonly phase: ToolActivityPhase;
  readonly status: string;
} {
  const has = (phase: string) =>
    activities.some((item) => item.phase === phase);
  const active = has('running');
  const phase = has('error')
    ? 'error'
    : active
    ? 'running'
    : has('waiting')
    ? 'waiting'
    : has('pending')
    ? 'pending'
    : has('stopped')
    ? 'stopped'
    : activities.length && activities.every((item) => item.phase === 'complete')
    ? 'complete'
    : 'unknown';
  const automatic = active
    ? activities
        .find((item) => item.phase === 'running' && item.label?.trim())
        ?.label?.trim() ?? 'Running tools…'
    : phase === 'complete'
    ? `Used ${activities.length} ${activities.length === 1 ? 'tool' : 'tools'}`
    : phase === 'error'
    ? 'Tool activity failed'
    : phase === 'waiting'
    ? 'Tool activity paused'
    : phase === 'pending'
    ? 'Waiting to run tools'
    : phase === 'stopped'
    ? 'Tool activity stopped'
    : 'Tool status unavailable';
  const label = caption ?? automatic;
  const cue = [
    has('error') && (active || caption !== undefined) ? 'Failed' : '',
    has('waiting') && (active || phase !== 'waiting' || caption !== undefined)
      ? 'Paused'
      : '',
    has('stopped') && (active || phase !== 'stopped' || caption !== undefined)
      ? 'Stopped'
      : '',
    phase === 'pending' && caption !== undefined ? 'Pending' : '',
    phase === 'unknown' && caption !== undefined ? 'Status unavailable' : '',
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    label,
    cue,
    active,
    phase,
    status: `${label}. ${activityProgress(activities)}.`,
  };
}
