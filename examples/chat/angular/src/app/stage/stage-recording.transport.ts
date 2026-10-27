import type { AgentQueueEntry, AgentTransport, LangGraphSubmitOptions, StreamEvent } from '@threadplane/langgraph';
import type { ThreadState } from '@langchain/langgraph-sdk';
import type { RecordedEvent, StageAction, StageBeat, StageHistorySnapshot, StageRecording, StageRun } from './stage-recording.types';

declare global {
  interface Window {
    /** Set by StageRecordingTransport in record mode; read by the record script. */
    __stageRecording?: StageRecording;
  }
}

/**
 * Wraps the real transport in record mode. The script announces each run's
 * action with `beginRun()` before performing it; the next `stream()` call
 * becomes that run. A reload has no stream, so the recording HOST — not the
 * script — calls `markReload()` to close it as an empty run, and only once the
 * adoption's history refresh has landed: a `markReload()` fired before that
 * refresh stamps the snapshot with a run count the replay can never serve.
 * Every `getHistory()` answer is kept with the number of runs recorded so far,
 * which is what the replay keys on.
 */
export class StageRecordingTransport implements AgentTransport {
  private readonly runs: StageRun[] = [];
  private readonly histories: StageHistorySnapshot[] = [];
  private pending: { beat: StageBeat; action: StageAction } | null = null;
  private threadId = '';
  private readonly recordedAt = new Date().toISOString();

  constructor(private readonly inner: AgentTransport, private readonly now: () => number = () => performance.now()) {}

  beginRun(beat: StageBeat, action: StageAction): void {
    // A second announcement before the first is consumed would silently
    // relabel the run about to stream with the WRONG action.
    if (this.pending) throw new Error('beginRun() while an action is still pending');
    this.pending = { beat, action };
  }

  markReload(): void {
    const p = this.pending;
    this.pending = null;
    if (!p || p.action.kind !== 'reload') throw new Error('markReload() needs a pending reload action');
    this.runs.push({ beat: p.beat, action: p.action, events: [] });
    this.publish();
  }

  onThreadId(id: string): void {
    this.threadId = id;
    this.publish();
  }

  recording(): StageRecording {
    return {
      version: 2,
      recordedAt: this.recordedAt,
      threadId: this.threadId,
      runs: this.runs.map((run) => ({ ...run, events: [...run.events] })),
      histories: [...this.histories],
    };
  }

  async *stream(assistantId: string, threadId: string | null, payload: unknown, signal: AbortSignal, options?: LangGraphSubmitOptions): AsyncIterable<StreamEvent> {
    const p = this.pending;
    this.pending = null;
    if (!p) throw new Error('stream() without beginRun(): the script must announce the action first');
    const events: RecordedEvent[] = [];
    this.runs.push({ beat: p.beat, action: p.action, events });
    const start = this.now();
    for await (const event of this.inner.stream(assistantId, threadId, payload, signal, options)) {
      events.push({ tMs: Math.round(this.now() - start), event });
      yield event;
    }
    // Once per run, not once per event: republishing a whole deep-copied
    // recording on every token made a long run quadratic.
    this.publish();
  }

  joinStream(threadId: string, runId: string, lastEventId: string | undefined, signal: AbortSignal): AsyncIterable<StreamEvent> {
    return this.inner.joinStream
      ? this.inner.joinStream(threadId, runId, lastEventId, signal)
      : (async function* (): AsyncIterable<StreamEvent> {
          /* no events */
        })();
  }

  createQueuedRun(assistantId: string, threadId: string, payload: unknown, signal: AbortSignal, options?: LangGraphSubmitOptions): Promise<AgentQueueEntry> {
    if (!this.inner.createQueuedRun) throw new Error('inner transport cannot queue runs');
    return this.inner.createQueuedRun(assistantId, threadId, payload, signal, options);
  }

  cancelRun(threadId: string, runId: string, signal: AbortSignal): Promise<void> {
    return this.inner.cancelRun ? this.inner.cancelRun(threadId, runId, signal) : Promise.resolve();
  }

  async getHistory(threadId: string, signal: AbortSignal): Promise<ThreadState[]> {
    const states = this.inner.getHistory ? await this.inner.getHistory(threadId, signal) : [];
    this.histories.push({ afterRun: this.runs.length, states });
    // Kept (unlike the per-event publish): a snapshot can be the LAST thing
    // recorded, so without this the window copy would be missing it.
    this.publish();
    return states;
  }

  updateState(...args: Parameters<NonNullable<AgentTransport['updateState']>>): ReturnType<NonNullable<AgentTransport['updateState']>> {
    return this.inner.updateState ? this.inner.updateState(...args) : Promise.resolve();
  }

  private publish(): void {
    if (typeof window !== 'undefined') window.__stageRecording = this.recording();
  }
}
