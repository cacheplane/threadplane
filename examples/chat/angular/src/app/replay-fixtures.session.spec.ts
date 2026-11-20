/// <reference types="node" />
// The committed recordings were captured from live runs. These specs replay
// them through the same sessions the hero and the stage create, so a recording
// and the session runtime cannot drift apart unnoticed: every prompt must show
// once, every pause must be answerable, and no run may end in an error.
import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { createAgentRef, provideAgent } from '@threadplane/angular';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { validateHeroRecording } from './hero/hero-recording.types';
import { HeroReplayTransport } from './hero/hero-replay.transport';
import type { DemoAgent, DemoSession } from './shell/agent-ref';
import { createDemoSession, SUBAGENT_TOOL_NAMES } from './shell/demo-session';
import { StageController } from './stage/stage-controller';
import { validateStageRecording } from './stage/stage-recording.types';
import { StageReplayTransport } from './stage/stage-replay.transport';
import { STAGE_PROMPTS } from './stage/stage-script';
import { buildTimeline } from './stage/stage-timeline';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(resolve(__dirname, '../../public', name), 'utf8'));

const REF = createAgentRef<DemoSession>('replay-fixture');

function agentOver(options: Parameters<typeof createDemoSession>[1]): DemoAgent {
  const injector = createEnvironmentInjector(
    provideAgent(REF, { createSession: (context) => createDemoSession(context, options) }),
    TestBed.inject(EnvironmentInjector),
  );
  return injector.get(REF.token);
}

const prompts = (agent: DemoAgent): string[] =>
  agent
    .messages()
    .filter((message) => message.role === 'user')
    .map((message) => message.content);

/** Every recorded prompt, in the order the runs submit them. */
const recordedPrompts = (runs: readonly { events: readonly { event: unknown }[] }[]): string[] => {
  const seen = new Map<string, string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (typeof value !== 'object' || value === null) return;
    const record = value as Record<string, unknown>;
    if (record['type'] === 'human' && typeof record['id'] === 'string' && typeof record['content'] === 'string') {
      if (!seen.has(record['id'])) seen.set(record['id'], record['content']);
    }
    Object.values(record).forEach(visit);
  };
  runs.forEach((run) => visit(run.events));
  return [...seen.values()];
};

describe('hero-replay.json replayed through the hero session', () => {
  beforeEach(() => TestBed.configureTestingModule({}));

  it('shows each prompt once, pauses for approval, resumes, and reaches the generated UI', async () => {
    const recording = validateHeroRecording(fixture('hero-replay.json'));
    const [first, second] = recordedPrompts(recording.runs);
    const transport = new HeroReplayTransport({ sleep: async () => undefined }, async () => recording);
    const agent = agentOver({ assistantId: 'hero-replay', transport });

    expect(await agent.submit({ message: first })).toBe('paused');
    expect(prompts(agent)).toEqual([first]);
    expect(agent.error()).toBeUndefined();
    const [pause] = agent.interrupts();
    expect(JSON.stringify(pause.value)).toContain('approval_request');
    expect(agent.toolCalls().map((call) => call.name)).toContain('list_backups');

    expect(
      await agent.resume([{ interruptId: pause.id, status: 'resolved', value: 'approved' }]),
    ).toBe('success');
    expect(agent.interrupts()).toEqual([]);
    expect(prompts(agent)).toEqual([first]);
    const deletion = agent.toolCalls().find((call) => call.name === 'delete_backups');
    expect(deletion?.status).toBe('complete');

    expect(await agent.submit({ message: second })).toBe('success');
    expect(prompts(agent)).toEqual([first, second]);
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    expect(JSON.stringify(agent.messages())).toMatch(/a2ui/i);
  });
});

describe('stage-replay.json replayed through the stage session', () => {
  const recording = validateStageRecording(fixture('stage-replay.json'));
  const timeline = buildTimeline(recording);
  let agent: DemoAgent;
  let controller: StageController;

  const runOf = (beat: string, kind: string, nth = 0) =>
    timeline.runs.filter((entry) => entry.run.beat === beat && entry.run.action.kind === kind)[nth];

  /** The prompts the recorded backend held when a run ended: its last `values` frame. */
  const recordedConversation = (entry: (typeof timeline.runs)[number]): string[] => {
    const frames = entry.run.events.filter(({ event }) => event.type === 'values');
    const messages = (frames.at(-1)?.event.messages ?? []) as { type?: string; content?: unknown }[];
    return messages.filter((message) => message.type === 'human').map((message) => String(message.content));
  };

  beforeEach(async () => {
    TestBed.configureTestingModule({});
    const transport = new StageReplayTransport(async () => recording);
    agent = agentOver({
      assistantId: 'stage-replay',
      transport,
      subagentToolNames: SUBAGENT_TOOL_NAMES,
    });
    controller = new StageController(agent, transport, await transport.ready(), recording);
  });

  it('streams the research inside a child agent related to its tool call', async () => {
    await controller.seek(runOf('subagents', 'submit').endMs);
    expect(agent.error()).toBeUndefined();
    expect(prompts(agent)).toEqual([STAGE_PROMPTS.stream, STAGE_PROMPTS.subagents]);
    expect(prompts(agent)).toEqual(recordedConversation(runOf('subagents', 'submit')));
    const [child] = agent.subagents();
    expect(child?.toolCallId).toBeTruthy();
    expect(child?.messages.length).toBeGreaterThan(0);
    expect(agent.toolCalls().some((call) => call.id === child?.toolCallId && call.name === 'research')).toBe(true);
  }, 30_000);

  it('restores the conversation after the reload and keeps its checkpoints', async () => {
    await controller.seek(runOf('persist', 'reload').endMs);
    expect(agent.error()).toBeUndefined();
    expect(prompts(agent)).toEqual([STAGE_PROMPTS.stream, STAGE_PROMPTS.subagents]);
    expect(agent.checkpoints()?.length).toBeGreaterThan(0);
    expect(agent.isThreadLoading()).toBe(false);
  }, 30_000);

  it('replays the alternative as the recorded backend ran it, in the recorded order', async () => {
    const alternative = runOf('persist', 'submit', 1);
    expect(alternative.run.action).toMatchObject({ kind: 'submit', message: STAGE_PROMPTS.fork });
    await controller.seek(alternative.endMs);
    expect(agent.error()).toBeUndefined();
    // The committed recording's alternative ran on the thread as it stood (its
    // state still holds the first proposal), so both turns show, in order.
    expect(recordedConversation(alternative)).toEqual([
      STAGE_PROMPTS.stream,
      STAGE_PROMPTS.subagents,
      STAGE_PROMPTS.proposal,
      STAGE_PROMPTS.fork,
    ]);
    expect(prompts(agent)).toEqual(recordedConversation(alternative));
  }, 30_000);

  it('holds on the approval pause, then resumes and renders the report', async () => {
    await controller.seek(timeline.hold.startMs + 1);
    expect(controller.phase()).toBe('pause');
    expect(agent.interrupts()).toHaveLength(1);
    expect(JSON.stringify(agent.interrupts()[0].value)).toContain('approval_request');

    await controller.seek(timeline.totalMs);
    expect(agent.error()).toBeUndefined();
    expect(agent.status()).toBe('idle');
    expect(agent.interrupts()).toEqual([]);
    expect(prompts(agent)).toEqual(recordedConversation(timeline.runs[timeline.runs.length - 1]));
    expect(prompts(agent)).toEqual([
      STAGE_PROMPTS.stream,
      STAGE_PROMPTS.subagents,
      STAGE_PROMPTS.proposal,
      STAGE_PROMPTS.fork,
      STAGE_PROMPTS.approve,
      STAGE_PROMPTS.render,
    ]);
    expect(JSON.stringify(agent.messages())).toContain('a2ui_JSON');
    expect(agent.checkpoints()?.length).toBeGreaterThan(0);
  }, 60_000);

  it('rewinds to an earlier beat without leaving later turns behind', async () => {
    await controller.seek(timeline.totalMs);
    await controller.seek(runOf('stream', 'submit').endMs);
    expect(agent.error()).toBeUndefined();
    expect(prompts(agent)).toEqual([STAGE_PROMPTS.stream]);
    expect(agent.subagents()).toEqual([]);
  }, 60_000);
});
