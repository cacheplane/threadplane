import type { StreamEvent } from '@threadplane/langgraph';
import type { ThreadState } from '@langchain/langgraph-sdk';

/** One transport event with its offset from the start of its run. */
export interface RecordedEvent { readonly tMs: number; readonly event: StreamEvent; }

export const STAGE_BEATS = ['stream', 'subagents', 'persist', 'approve', 'render'] as const;
export type StageBeat = (typeof STAGE_BEATS)[number];

/**
 * What the script did to the agent to produce a run. Replayed verbatim by the
 * controller, so the replay performs the same calls the recording did.
 */
export type StageAction =
  | { readonly kind: 'submit'; readonly message: string; /** Fork: index into the agent's history() at that moment, newest checkpoint first. */ readonly checkpointIndex?: number }
  | { readonly kind: 'resume'; readonly value: string }
  /** Simulated page reload: reset, then re-adopt the thread so history restores it. Has no stream. */
  | { readonly kind: 'reload' };

export interface StageRun {
  readonly beat: StageBeat;
  readonly action: StageAction;
  readonly events: readonly RecordedEvent[];
}

/** A `getHistory` response, keyed by how many runs had been recorded when it was answered. */
export interface StageHistorySnapshot { readonly afterRun: number; readonly states: readonly ThreadState[]; }

export interface StageRecording {
  readonly version: 2;
  readonly recordedAt: string;
  readonly threadId: string;
  readonly runs: readonly StageRun[];
  readonly histories: readonly StageHistorySnapshot[];
}

const KINDS = new Set<StageAction['kind']>(['submit', 'resume', 'reload']);

/** Throws a readable error when the fixture is not a usable recording. */
export function validateStageRecording(input: unknown): StageRecording {
  if (typeof input !== 'object' || input === null) throw new Error('stage recording must be an object');
  const rec = input as Partial<StageRecording>;
  if (rec.version !== 2) throw new Error('stage recording version must be 2');
  if (typeof rec.threadId !== 'string' || !rec.threadId) throw new Error('stage recording needs a threadId');
  if (!Array.isArray(rec.runs) || rec.runs.length === 0) throw new Error('stage recording needs runs');
  if (!Array.isArray(rec.histories)) throw new Error('stage recording needs histories');
  (rec.histories as readonly Partial<StageHistorySnapshot>[]).forEach((h: Partial<StageHistorySnapshot>, k: number) => {
    if (typeof h.afterRun !== 'number' || !Number.isInteger(h.afterRun) || h.afterRun < 0) {
      throw new Error(`history ${k} has no numeric afterRun`);
    }
    if (!Array.isArray(h.states)) throw new Error(`history ${k} has no states array`);
  });
  const beatsSeen: StageBeat[] = [];
  rec.runs.forEach((run: Partial<StageRun>, i: number) => {
    if (!run.beat || !(STAGE_BEATS as readonly string[]).includes(run.beat)) throw new Error(`run ${i} has no beat`);
    if (!run.action || !KINDS.has(run.action.kind)) throw new Error(`run ${i} has no action`);
    if (run.action.kind === 'submit' && run.action.checkpointIndex !== undefined
        && (!Number.isInteger(run.action.checkpointIndex) || run.action.checkpointIndex < 0)) {
      throw new Error(`run ${i} has a bad checkpointIndex`);
    }
    if (!Array.isArray(run.events)) throw new Error(`run ${i} has no events`);
    if (run.events.length === 0 && run.action.kind !== 'reload') throw new Error(`run ${i} has no events`);
    // A reload streams nothing: the transport skips reload runs, so any events
    // on one would silently be answered to the NEXT run's stream.
    if (run.events.length > 0 && run.action.kind === 'reload') {
      throw new Error(`run ${i} is a reload and must have no events`);
    }
    let prevTMs = -Infinity;
    (run.events as readonly Partial<RecordedEvent>[]).forEach((e: Partial<RecordedEvent>, j: number) => {
      if (typeof e?.tMs !== 'number' || !Number.isFinite(e.tMs)) throw new Error(`run ${i} event ${j} has no numeric tMs`);
      if (typeof e.event !== 'object' || e.event === null) throw new Error(`run ${i} event ${j} has no event`);
      if (e.tMs < prevTMs) throw new Error(`run ${i} events are not in time order`);
      prevTMs = e.tMs;
    });
    if (beatsSeen[beatsSeen.length - 1] !== run.beat) beatsSeen.push(run.beat);
  });
  const resumeRuns = rec.runs.filter((r: StageRun) => r.action.kind === 'resume');
  if (resumeRuns.length !== 1) throw new Error('stage recording supports exactly one resume run');
  const missing = STAGE_BEATS.filter((b) => !beatsSeen.includes(b));
  if (missing.length > 0) {
    throw new Error(`stage recording is missing beats: ${missing.join(', ')}`);
  }
  if (beatsSeen.length !== STAGE_BEATS.length || beatsSeen.some((b, i) => b !== STAGE_BEATS[i])) {
    throw new Error(`stage recording beats are out of order: ${beatsSeen.join(' → ')}`);
  }
  const approveSubmit = rec.runs.findIndex((r: StageRun) => r.beat === 'approve' && r.action.kind === 'submit');
  const resume = rec.runs[approveSubmit + 1] as StageRun | undefined;
  if (approveSubmit < 0 || resume?.action.kind !== 'resume') {
    throw new Error('the approve beat needs a submit run followed by a resume run');
  }
  return rec as StageRecording;
}
