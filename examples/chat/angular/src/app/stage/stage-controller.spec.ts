import { describe, expect, it, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { createEnvironmentInjector, EnvironmentInjector, signal } from '@angular/core';
import { createAgentRef, provideAgent } from '@threadplane/angular';
import type { DemoAgent, DemoSession } from '../shell/agent-ref';
import { createDemoSession } from '../shell/demo-session';
import { StageReplayTransport } from './stage-replay.transport';
import { StageController, startedFrom } from './stage-controller';
import { buildTimeline } from './stage-timeline';
import type { StageRecording } from './stage-recording.types';

const human = (id: string, content: string) => ({ id, type: 'human', content });
const ai = (id: string, content: string) => ({ id, type: 'ai', content });
/** A `values` frame as the transport delivers it: the state under `data`, and spread beside it. */
const values = (tMs: number, messages: unknown[], extra: Record<string, unknown> = {}) =>
  ({ tMs, event: { type: 'values', messages, ...extra, data: { messages, ...extra } } as never });

/** A recording whose events are `values` snapshots, which the session applies directly. */
const REC: StageRecording = {
  version: 2, recordedAt: '2026-09-06T00:00:00.000Z', threadId: 'thread-1',
  runs: [
    { beat: 'stream', action: { kind: 'submit', message: 'Q1' }, events: [values(0, [human('h1', 'Q1')]), values(100, [human('h1', 'Q1'), ai('a1', 'A1')])] },
    { beat: 'persist', action: { kind: 'reload' }, events: [] },
    { beat: 'persist', action: { kind: 'submit', message: 'Q2' }, events: [values(0, [human('h1', 'Q1'), ai('a1', 'A1'), human('h2', 'Q2'), ai('a2', 'A2')])] },
    { beat: 'persist', action: { kind: 'submit', message: 'Q3', checkpointIndex: 0 }, events: [values(0, [human('h1', 'Q1'), ai('a1', 'A1'), human('h3', 'Q3'), ai('a3', 'A3')])] },
    { beat: 'approve', action: { kind: 'submit', message: 'Clean up' }, events: [values(0, [human('h4', 'Clean up')]), values(200, [human('h4', 'Clean up')], { __interrupt__: [{ value: { type: 'approval_request', reason: 'Delete 3' } }] })] },
    { beat: 'approve', action: { kind: 'resume', value: 'approved' }, events: [values(0, [human('h4', 'Clean up'), ai('a4', 'Deleted 3')])] },
    { beat: 'render', action: { kind: 'submit', message: 'Form' }, events: [values(0, [human('h4', 'Clean up'), ai('a4', 'Deleted 3'), human('h5', 'Form'), ai('a5', '---a2ui_JSON---')])] },
  ],
  histories: [{ afterRun: 1, states: [{ values: { messages: [human('h1', 'Q1'), ai('a1', 'A1')] }, checkpoint: { checkpoint_id: 'cp-1' } } as never] }],
};

const REF = createAgentRef<DemoSession>('stage-test');

function until(pred: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => { if (pred()) return resolve(); if (Date.now() - start > ms) return reject(new Error('timeout')); setTimeout(tick, 5); };
    tick();
  });
}
const text = (m: unknown) => String((m as { content?: unknown }).content ?? '');

describe('startedFrom — did a recorded run start from a checkpoint', () => {
  const run = (...frames: StageRecording['runs'][number]['events'][number][]): StageRecording['runs'][number] => ({
    beat: 'persist',
    action: { kind: 'submit', message: 'Q', checkpointIndex: 0 },
    events: frames,
  });

  it('is true when the first values frame is the checkpoint plus the prompt', () => {
    expect(startedFrom(run(values(0, [human('h1', 'Q1'), ai('a1', 'A1'), human('h3', 'Q3')])), 2)).toBe(true);
  });

  it('is false when the recorded run opened on a longer thread than the checkpoint held', () => {
    const tip = [human('h1', 'Q1'), ai('a1', 'A1'), human('h2', 'Q2'), ai('a2', 'A2'), human('h3', 'Q3')];
    expect(startedFrom(run(values(0, tip)), 2)).toBe(false);
  });

  it('reads only the first values frame, and trusts the recorded action when it cannot tell', () => {
    const later = values(10, [human('h1', 'Q1'), ai('a1', 'A1'), human('h3', 'Q3'), ai('a3', 'A3')]);
    expect(startedFrom(run(values(0, [human('h1', 'Q1'), ai('a1', 'A1'), human('h3', 'Q3')]), later), 2)).toBe(true);
    expect(startedFrom(run({ tMs: 0, event: { type: 'updates' } as never }), 2)).toBe(true);
    expect(startedFrom(run(values(0, [human('h3', 'Q3')])), undefined)).toBe(true);
  });
});

/**
 * Two recordings of the same fork, differing only in what the recorded backend
 * did: started the run from the checkpoint, or ran it on the thread as it stood.
 */
function forkRecording(forked: boolean): StageRecording {
  const first = [human('h1', 'Q1'), ai('a1', 'A1')];
  const second = [...first, human('h2', 'Q2'), ai('a2', 'A2')];
  const base = forked ? first : second;
  const state = (id: string, messages: unknown[]) =>
    ({ values: { messages }, next: [], tasks: [], metadata: {}, checkpoint: { checkpoint_id: id, checkpoint_ns: '', thread_id: 'thread-1' }, parent_checkpoint: null, created_at: null }) as never;
  return {
    version: 2, recordedAt: '2026-09-06T00:00:00.000Z', threadId: 'thread-1',
    runs: [
      { beat: 'stream', action: { kind: 'submit', message: 'Q1' }, events: [values(0, [human('h1', 'Q1')]), values(10, first)] },
      { beat: 'subagents', action: { kind: 'submit', message: 'Q2' }, events: [values(0, [...first, human('h2', 'Q2')]), values(10, second)] },
      // checkpointIndex 1: the newest-first page is [after Q2, after Q1].
      { beat: 'persist', action: { kind: 'submit', message: 'Q3', checkpointIndex: 1 }, events: [values(0, [...base, human('h3', 'Q3')]), values(10, [...base, human('h3', 'Q3'), ai('a3', 'A3')])] },
      { beat: 'approve', action: { kind: 'submit', message: 'Clean up' }, events: [values(0, [human('h4', 'Clean up')], { __interrupt__: [{ value: { type: 'approval_request' } }] })] },
      { beat: 'approve', action: { kind: 'resume', value: 'approved' }, events: [values(0, [human('h4', 'Clean up'), ai('a4', 'Done')])] },
      { beat: 'render', action: { kind: 'submit', message: 'Form' }, events: [values(0, [human('h5', 'Form'), ai('a5', 'ok')])] },
    ],
    histories: [
      { afterRun: 1, states: [state('cp-1', first)] },
      { afterRun: 2, states: [state('cp-2', second), state('cp-1', first)] },
    ],
  };
}

describe('StageController — a recorded fork', () => {
  async function replayFork(forked: boolean) {
    TestBed.configureTestingModule({});
    const recording = forkRecording(forked);
    const transport = new StageReplayTransport(async () => recording);
    const stream = vi.spyOn(transport, 'stream');
    const injector = createEnvironmentInjector(
      provideAgent(REF, {
        createSession: async (context) => createDemoSession(context, { assistantId: 'stage', transport }),
      }),
      TestBed.inject(EnvironmentInjector),
    );
    const agent = injector.get(REF.token);
    const timeline = await transport.ready();
    const controller = new StageController(agent, transport, timeline, recording);
    await controller.seek(timeline.runs[2].endMs);
    await until(() => agent.status() === 'idle' && agent.messages().some((m) => text(m) === 'A3'));
    return { agent, forkOptions: stream.mock.calls[2]?.[4] };
  }

  it('starts the run from the checkpoint when the recorded backend did, dropping the later turn', async () => {
    const { agent, forkOptions } = await replayFork(true);
    expect(forkOptions).toMatchObject({ checkpointId: 'cp-1' });
    expect(agent.messages().map(text)).toEqual(['Q1', 'A1', 'Q3', 'A3']);
  });

  it('replays a plain submit when the recorded backend ran the turn on the thread as it stood', async () => {
    const { agent, forkOptions } = await replayFork(false);
    expect(forkOptions).toBeUndefined();
    expect(agent.messages().map(text)).toEqual(['Q1', 'A1', 'Q2', 'A2', 'Q3', 'A3']);
  });
});

describe('StageController against the real LangGraph agent', () => {
  let transport: StageReplayTransport;
  let agent: DemoAgent;
  let controller: StageController;
  const tl = buildTimeline(REC);

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    transport = new StageReplayTransport(async () => REC);
    const injector = createEnvironmentInjector(
      provideAgent(REF, {
        threadId: signal<string | null>(null),
        // The stage's own session options, over the replay transport.
        createSession: async (context) => createDemoSession(context, { assistantId: 'stage', transport }),
      }),
      TestBed.inject(EnvironmentInjector),
    );
    agent = injector.get(REF.token);
    controller = new StageController(agent, transport, await transport.ready(), REC);
  });

  it('seeking forward performs each run\'s action and applies events up to t', async () => {
    await controller.seek(0);
    await until(() => agent.messages().length === 1);
    expect(controller.phase()).toBe('stream');
    await controller.seek(tl.runs[0].endMs);
    await until(() => agent.messages().length === 2);
    expect(controller.applied()).toBe(2);
  });

  it('the reload run blanks and restores the transcript from recorded history', async () => {
    await controller.seek(tl.runs[1].startMs + 1);
    await until(() => agent.messages().length === 2 && agent.history()?.length === 1);
    expect(agent.history()?.[0]?.checkpoint?.checkpoint_id).toBe('cp-1');
    expect(agent.checkpoints()?.[0]?.id).toBe('cp-1');
  });

  it('holds at the interrupt: seeking inside the hold does not resume', async () => {
    await controller.seek(tl.hold.startMs + 1);
    await until(() => !!agent.interrupts()?.length);
    expect(controller.phase()).toBe('pause');
    const before = agent.messages().length;
    await controller.seek(tl.hold.endMs - 1);
    await new Promise((r) => setTimeout(r, 30));
    expect(agent.messages().length).toBe(before);
    expect(agent.interrupts()?.length).toBe(1);
  });

  it('crossing the hold resumes and the audit lands', async () => {
    await controller.seek(tl.runs[5].endMs);
    await until(() => agent.messages().some((m) => text(m).includes('Deleted 3')));
    expect(agent.interrupts() ?? []).toEqual([]);
    expect(controller.phase()).toBe('resume');
  });

  it('rewinding resets and fast-forwards to an earlier point', async () => {
    await controller.seek(tl.totalMs);
    await until(() => agent.messages().some((m) => text(m).includes('a2ui')));
    await controller.seek(tl.runs[0].endMs);
    await until(() => agent.messages().length === 2 && !agent.messages().some((m) => text(m).includes('a2ui')));
    expect(controller.phase()).toBe('stream');
  });

  it('resolves a seek only once the events for its target are applied', async () => {
    // No until(): resolution alone must imply the stage is showing the target.
    // The intermediate target is coalesced into the last pass and never
    // applied on its own, so both callers settle on the final one.
    await Promise.all([controller.seek(10), controller.seek(tl.runs[0].endMs)]);
    expect(agent.messages().length).toBe(2);
    expect(controller.applied()).toBe(2);
  });

  it('coalesces bursts: many seeks in one frame perform each action once', async () => {
    // Every submit the controller performs opens exactly one stream on the
    // transport, so the stream count is the count of performed actions.
    const stream = vi.spyOn(transport, 'stream');
    await Promise.all([controller.seek(10), controller.seek(20), controller.seek(tl.runs[0].endMs)]);
    await until(() => agent.messages().length === 2);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(agent.messages().filter((m) => m.role === 'user').map(text)).toEqual(['Q1']);
  });
});
