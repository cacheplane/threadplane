// examples/chat/angular/src/app/stage/stage-replay.transport.ts
import { signal } from '@angular/core';
import type { AgentQueueEntry, AgentTransport, LangGraphSubmitOptions, StreamEvent } from '@threadplane/langgraph';
import type { ThreadState } from '@langchain/langgraph-sdk';
import { ReplayUserIds } from '../replay-user-ids';
import { validateStageRecording, type StageRecording } from './stage-recording.types';
import { buildTimeline, type StageTimeline } from './stage-timeline';

export const STAGE_RECORDING_URL = '/stage-replay.json';

async function fetchRecording(): Promise<StageRecording> {
  const res = await fetch(STAGE_RECORDING_URL);
  if (!res.ok) throw new Error(`stage recording fetch failed: ${res.status}`);
  return validateStageRecording(await res.json());
}

/**
 * AgentTransport that replays the committed stage recording under a gate:
 * each `stream()` call answers the next non-reload run, yielding events whose
 * ABSOLUTE recorded time (run start + tMs) is at or before the current target
 * `t`, and waiting for `seek()` to move `t` before yielding the rest. There is
 * no clock: the parent's scroll is the clock. Backward seeks are the
 * controller's job (reset + fast-forward); this transport only ever moves
 * forward within a run, and `reset()` ends any stream still waiting.
 */
export class StageReplayTransport implements AgentTransport {
  private recording: Promise<StageRecording> | null = null;
  private timeline: StageTimeline | null = null;
  private t = 0;
  private readonly wakers = new Set<() => void>();
  /** Bumped by reset(); a stream whose generation is stale ends itself. */
  private generation = 0;
  /** Index of the next run `stream()` will answer. Reload runs are skipped. */
  private nextRun = 0;
  get runIndex(): number { return this.nextRun; }
  /** Renames the recorded prompts to the ids the replaying session sent. */
  private readonly userIds = new ReplayUserIds();
  private readonly appliedCount = signal(0);
  readonly appliedSignal = this.appliedCount.asReadonly();

  constructor(private readonly load: () => Promise<StageRecording> = fetchRecording) {}

  async ready(): Promise<StageTimeline> {
    const rec = await this.getRecording();
    this.timeline ??= buildTimeline(rec);
    return this.timeline;
  }
  recordingData(): Promise<StageRecording> { return this.getRecording(); }
  /** Events yielded so far across all runs since the last reset. */
  applied(): number { return this.appliedCount(); }

  seek(t: number): void {
    this.t = t;
    this.wakeAll();
  }
  /**
   * `t` is deliberately left alone; the controller re-seeks after resetting.
   */
  reset(): void {
    this.generation += 1;
    this.nextRun = 0;
    this.userIds.reset();
    this.appliedCount.set(0);
    this.wakeAll();
  }

  async *stream(_a: string, _thread: string | null, payload: unknown, abortSignal: AbortSignal, _o?: LangGraphSubmitOptions): AsyncIterable<StreamEvent> {
    const gen = this.generation;
    const tl = await this.ready();
    if (abortSignal.aborted || gen !== this.generation) return;
    while (tl.runs[this.nextRun]?.run.action.kind === 'reload') this.nextRun += 1;
    const entry = tl.runs[this.nextRun];
    if (!entry) return;
    this.nextRun += 1;
    this.userIds.adopt(payload, entry.run.events);
    for (const { tMs, event } of entry.run.events) {
      while (entry.startMs + tMs > this.t) {
        if (abortSignal.aborted || gen !== this.generation) return;
        await this.wait(abortSignal);
      }
      if (abortSignal.aborted || gen !== this.generation) return;
      this.appliedCount.update((n) => n + 1);
      yield this.userIds.translate(event);
    }
  }

  /**
   * A session without a thread creates one before its first run. The stage
   * always adopts the recorded thread first, so this only satisfies the
   * session's requirement that a supplied transport can create a thread.
   */
  async createThread(): Promise<string> {
    return (await this.getRecording()).threadId;
  }

  private wait(abortSignal: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
      const wake = () => { this.wakers.delete(wake); abortSignal.removeEventListener('abort', wake); resolve(); };
      this.wakers.add(wake);
      abortSignal.addEventListener('abort', wake, { once: true });
    });
  }
  private wakeAll(): void { for (const w of [...this.wakers]) w(); }

  /**
   * The snapshot recorded at exactly this replay position, or none.
   *
   * A stale snapshot is deliberately NOT served: a session reads the history
   * page again when a run ends, for its checkpoint views (`historyState`), and
   * a thread it adopts is restored from the page it loads. Answering an
   * at-or-before snapshot would hand it checkpoints, and on a reload a whole
   * transcript, from whatever the recorder last captured. Serving nothing
   * leaves the streamed transcript and the views alone. The recorder must
   * therefore capture a snapshot after every run it wants restored (the
   * reload run above all).
   *
   * Before the first run has streamed nothing has been replayed, so a
   * pre-run snapshot is never answered: it would seed the transcript with a
   * transcript the stage has not shown yet. When several snapshots share a
   * position the LAST one wins — it is the most recently recorded.
   */
  async getHistory(_thread: string, _signal: AbortSignal): Promise<ThreadState[]> {
    if (this.runIndex === 0) return [];
    const rec = await this.getRecording();
    for (let i = rec.histories.length - 1; i >= 0; i--) {
      if (rec.histories[i].afterRun === this.runIndex) {
        return this.userIds.translate(rec.histories[i].states) as ThreadState[];
      }
    }
    return [];
  }
  async createQueuedRun(_a: string, threadId: string, payload: unknown, _s: AbortSignal, options?: LangGraphSubmitOptions): Promise<AgentQueueEntry> {
    return { id: 'stage-replay-queued-run', threadId, values: payload, options: { ...options, multitaskStrategy: 'enqueue' }, createdAt: new Date() };
  }
  async cancelRun(): Promise<void> { return; }
  async *joinStream(): AsyncIterable<StreamEvent> { yield* []; }

  private getRecording(): Promise<StageRecording> {
    this.recording ??= this.load().catch((err) => { this.recording = null; throw err; });
    return this.recording;
  }
}
