import { computed, signal, type Signal } from '@angular/core';
import type { DemoAgent } from '../shell/agent-ref';
import type { StageRecording, StageRun } from './stage-recording.types';
import { phaseReachedAt, runsStartedBy, type StagePhase, type StageTimeline, type TimelineRun } from './stage-timeline';
import type { StageReplayTransport } from './stage-replay.transport';

/**
 * At a shared boundary, finish the outgoing run before starting the next
 * action. This lets a still show a settled answer and its refreshed history
 * without already submitting the next prompt or blanking for a reload.
 * The first action starts at zero; later actions start strictly after their
 * startMs. `phaseReachedAt` follows the same outgoing-frame convention.
 */

/** Ceiling on how long a drain waits for the agent to go idle before moving on. */
const SETTLE_TIMEOUT_MS = 2000;
/** Ceiling on how long we wait to OBSERVE a performed run starting. */
const RUN_START_TIMEOUT_MS = 500;
/** Ceiling on how long a seek waits for the transport's events to be applied. */
const APPLY_TIMEOUT_MS = 2000;

/** One `seek()` caller, waiting for a pass that reaches its target. */
interface SeekWaiter {
  readonly target: number;
  readonly resolve: () => void;
}

/**
 * Drives the replay agent to any recorded time.
 *
 * Forward: for each run whose start has been crossed and not yet performed,
 * drain the previous run to that run's start, then perform this run's recorded
 * action (submit / resume / reload), and finally open the transport's gate to
 * `t`. Backward: reset the agent and the transport, then fast-forward. Seeks
 * are coalesced so a burst inside one frame performs each action once, and a
 * seek that arrives while one is in flight is applied after it, never
 * concurrently — a submit replaces whatever run the session has open.
 *
 * `seek(t)` resolves only once a pass has completed AND the events recorded at
 * or before its target have been applied, so `await seek(t)` implies the stage
 * is showing t. A target that is superseded by a later seek is never applied
 * on its own — it is coalesced into the last pass, and its waiters resolve
 * when that pass completes.
 */
export class StageController {
  private performed = -1;
  private target = 0;
  private inFlight: Promise<void> | null = null;
  private pending: number | null = null;
  private waiters: SeekWaiter[] = [];
  private readonly tSig = signal(0);
  readonly phase = computed<StagePhase>(() => phaseReachedAt(this.timeline, this.tSig()));
  /** Events the transport has yielded since the last reset. */
  readonly applied: Signal<number>;
  readonly t = this.tSig.asReadonly();

  constructor(
    private readonly agent: DemoAgent,
    private readonly transport: StageReplayTransport,
    private readonly timeline: StageTimeline,
    private readonly recording: StageRecording,
  ) {
    // Assigned here rather than in a field initializer: parameter properties
    // are not bound until the constructor body runs.
    this.applied = transport.appliedSignal;
  }

  seek(t: number): Promise<void> {
    const clamped = Math.max(0, Math.min(this.timeline.totalMs, t));
    const waited = new Promise<void>((resolve) => this.waiters.push({ target: clamped, resolve }));
    if (this.inFlight) this.pending = clamped;
    else this.dispatch(clamped);
    return waited;
  }

  private dispatch(t: number): void {
    this.inFlight = this.run(t)
      .catch((err: unknown) => console.warn('[stage] seek failed', err))
      .finally(() => {
        this.inFlight = null;
        const next = this.pending;
        this.pending = null;
        // A superseded target is never applied on its own: its waiters ride
        // the last pass, so they are only released once no pass is pending.
        if (next !== null) {
          this.dispatch(next);
          this.release((w) => w.target === t);
          return;
        }
        this.release(() => true);
      });
  }

  private release(match: (w: SeekWaiter) => boolean): void {
    const kept: SeekWaiter[] = [];
    for (const w of this.waiters) {
      if (match(w)) w.resolve();
      else kept.push(w);
    }
    this.waiters = kept;
  }

  private async run(t: number): Promise<void> {
    if (t < this.target) this.reset();
    this.target = t;
    this.tSig.set(t);
    if (this.performed < 0) {
      this.agent.switchThread(this.recording.threadId);
      await this.drain(-1);
    }
    for (const entry of runsStartedBy(this.timeline, t)) {
      if (entry.index <= this.performed) continue;
      // Drain the previous run to this run's start before acting: the agent's
      // submit path aborts whatever stream is open, so acting early would
      // truncate the run being replaced.
      this.transport.seek(entry.startMs);
      if (this.performed >= 0) await this.drain(this.performed);
      this.performed = entry.index;
      this.perform(entry.run);
      await this.observeStart(entry);
    }
    this.transport.seek(t);
    await this.awaitApplied(t);
  }

  private reset(): void {
    this.performed = -1;
    this.target = 0;
    this.agent.switchThread(null);
    this.transport.reset();
  }

  private perform(run: StageRun): void {
    const action = run.action;
    switch (action.kind) {
      case 'submit': {
        let checkpointId: string | undefined;
        if (action.checkpointIndex !== undefined) {
          checkpointId = checkpointIdAt(this.agent, action.checkpointIndex);
          if (!checkpointId) {
            console.warn('[stage] fork checkpoint missing', { checkpointIndex: action.checkpointIndex });
          } else if (!startedFrom(run, checkpointMessages(this.agent, checkpointId))) {
            // The recorded backend ran this turn on the thread as it stood,
            // not from the checkpoint. Starting from the checkpoint here would
            // set the transcript back to it while the recorded stream carries
            // the whole thread, so the turn is replayed as the plain submit
            // the backend performed.
            checkpointId = undefined;
          }
        }
        this.agent
          .submit({ message: action.message }, checkpointId ? { run: { checkpointId } } : undefined)
          .catch((err: unknown) => console.warn('[stage] submit failed', err));
        return;
      }
      case 'resume': {
        const interrupt = this.agent.interrupts()[0];
        if (!interrupt) {
          console.warn('[stage] resume without a pending interrupt');
          return;
        }
        this.agent
          .resume([{ interruptId: interrupt.id, status: 'resolved', value: action.value }])
          .catch((err: unknown) => console.warn('[stage] resume failed', err));
        return;
      }
      case 'reload':
        // A simulated page reload: drop the thread (which aborts the open
        // stream and blanks the transcript), then re-adopt it so the new
        // session restores it from the recorded history snapshot.
        this.agent.switchThread(null);
        this.agent.switchThread(this.recording.threadId);
        return;
    }
  }

  /**
   * Waits until a run we just performed has visibly STARTED — the agent
   * reports loading, or the transport yielded an event. Gating on an
   * observation rather than on a status read taken before the first await is
   * what makes the following drain meaningful: `submit()` is asynchronous, so
   * a pre-await read of `status()` can still be idle and let the drain
   * fall straight through. A reload has no stream to observe.
   */
  private async observeStart(entry: TimelineRun): Promise<void> {
    if (entry.run.action.kind === 'reload') return;
    const before = this.transport.applied();
    const deadline = Date.now() + RUN_START_TIMEOUT_MS;
    while (this.agent.status() !== 'running' && this.transport.applied() === before) {
      if (Date.now() > deadline) {
        console.warn('[stage] settle timed out', { run: entry.index });
        return;
      }
      await macrotask();
    }
  }

  /** Waits for the agent to go idle, so the next action starts from a settled transcript. */
  private async drain(runIndex: number): Promise<void> {
    const deadline = Date.now() + SETTLE_TIMEOUT_MS;
    while (this.agent.status() === 'running' || this.agent.isThreadLoading()) {
      if (Date.now() > deadline) {
        console.warn('[stage] settle timed out', { run: runIndex });
        return;
      }
      await macrotask();
    }
  }

  /**
   * Waits until every event recorded at or before `t` has been yielded by the
   * transport, and then for one quiet macrotask so the session has applied the
   * last of them. This is what lets `await seek(t)` imply "the stage shows t"
   * without the caller polling.
   */
  private async awaitApplied(t: number): Promise<void> {
    const expected = this.expectedApplied(t);
    const deadline = Date.now() + APPLY_TIMEOUT_MS;
    let previous = -1;
    for (;;) {
      const now = this.transport.applied();
      if (now >= expected && now === previous) return;
      if (Date.now() > deadline) {
        console.warn('[stage] apply timed out', { t, expected, applied: now });
        return;
      }
      previous = now;
      await macrotask();
    }
  }

  /** How many recorded events fall at or before t in absolute recorded time. */
  private expectedApplied(t: number): number {
    let n = 0;
    for (const r of runsStartedBy(this.timeline, t)) {
      for (const e of r.run.events) if (r.startMs + e.tMs <= t) n += 1;
    }
    return n;
  }
}

/**
 * The checkpoint a recorded fork starts from. A recording stores the index
 * into the thread's history as the backend lists it, newest first, which is
 * the order of `agent.history()`.
 */
export function checkpointIdAt(agent: Pick<DemoAgent, 'history'>, index: number): string | undefined {
  return agent.history()?.[index]?.checkpoint?.checkpoint_id ?? undefined;
}

/** How many messages the agent's loaded checkpoint holds, when it has that checkpoint's state. */
function checkpointMessages(agent: Pick<DemoAgent, 'checkpoints'>, checkpointId: string): number | undefined {
  const saved = agent.checkpoints()?.find((checkpoint) => checkpoint.id === checkpointId);
  const messages = saved?.values['messages'];
  return Array.isArray(messages) ? messages.length : undefined;
}

/**
 * Whether a recorded run started from a checkpoint holding `held` messages. A
 * run's first `values` frame is the state it starts from plus its prompt, so
 * a run from that checkpoint opens with exactly one message more. Unknown
 * either way reads as started there: the recorded action says so.
 */
export function startedFrom(run: StageRun, held: number | undefined): boolean {
  if (held === undefined) return true;
  for (const { event } of run.events) {
    if (event.type !== 'values') continue;
    const messages = event.messages ?? (event['data'] as { messages?: unknown } | undefined)?.messages;
    return !Array.isArray(messages) || messages.length === held + 1;
  }
  return true;
}

/** A macrotask tick: also flushes the microtasks the session applies events on. */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
