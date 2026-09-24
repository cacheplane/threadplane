import { test, expect } from '@playwright/test';
import { Client, type Checkpoint, type ThreadState } from '@langchain/langgraph-sdk';

const prompt = 'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.';
const acknowledgment = 'Understood — a $47.50 refund to cus_a8x2k for a duplicate charge. Pausing for operator approval; no refund is issued until a human reviews and approves.';
const cancellation = 'Refund cancelled by operator. No charge issued.';
const editedAmount = 31.25;
const issued = 'Refund of $31.25 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.';
const draft = {
  customer_id: 'cus_a8x2k', amount: 47.5,
  reason: 'Customer was charged twice for the same order.',
};
type State = {
  messages: { id: string; type: string; content: unknown }[];
  customer_id?: string;
  amount?: number;
  reason?: string;
  decision_approved?: boolean;
  refund_id?: string;
};
type Interrupt = { id: string; value: unknown };
type CheckpointEvent = {
  config: { configurable?: Record<string, unknown> };
  values: State;
  next: string[];
  tasks: { id: string; name: string }[];
};
type Position = Checkpoint & { checkpoint_id: string };

function environment(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Global setup must expose ${name}`);
  return value;
}

// Whitelist routing fields; never replay authentication or physical-run data
// from the complete event configurable object.
function position(config: Record<string, unknown> | undefined): Position {
  if (!config) throw new Error('Checkpoint must include routing configuration');
  expect(config['thread_id']).toEqual(expect.stringMatching(/\S/));
  expect(config['checkpoint_ns']).toBe('');
  expect(config['checkpoint_id']).toEqual(expect.stringMatching(/\S/));
  const map = config['checkpoint_map'];
  if (map !== undefined) {
    expect(map).not.toBeNull();
    expect(typeof map).toBe('object');
    expect(Array.isArray(map)).toBe(false);
    for (const id of Object.values(map as object)) expect(id).toEqual(expect.any(String));
  }
  return {
    thread_id: config['thread_id'] as string,
    checkpoint_ns: '',
    checkpoint_id: config['checkpoint_id'] as string,
    checkpoint_map: map === undefined ? undefined : { ...map as Record<string, string> },
  };
}

async function modelJournal() {
  const response = await fetch(`${environment('INTERRUPTS_AIMOCK_URL')}/__aimock/journal`, {
    signal: AbortSignal.timeout(5_000),
  });
  expect(response.ok).toBe(true);
  const entries = await response.json() as {
    body?: { messages?: { role: string; content: unknown }[]; response_format?: { type: string } };
  }[];
  return entries.filter((entry) => entry.body?.messages?.some((message) => message.role === 'user' && message.content === prompt));
}

async function run(
  api: Client<State>, threadId: string,
  options: { checkpoint?: Position; resume?: { approved: boolean; amount?: number }; initial?: boolean },
) {
  let runId: string | undefined;
  const checkpoints: CheckpointEvent[] = [];
  const interrupts: Interrupt[] = [];
  for await (const event of api.runs.stream(threadId, 'interrupts', {
    input: options.initial ? { messages: [{ id: 'paused-checkpoint-question', type: 'human', content: prompt }] } : null,
    checkpoint: options.checkpoint,
    command: options.resume ? { resume: options.resume } : undefined,
    streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
  })) {
    expect(event.event).not.toBe('error');
    if (event.event === 'metadata') runId = event.data.run_id;
    if (event.event === 'checkpoints') {
      const checkpoint = event.data as CheckpointEvent;
      expect(position(checkpoint.config.configurable).thread_id).toBe(threadId);
      checkpoints.push(checkpoint);
    }
    if (event.event === 'values') {
      const values = event.data as State & { __interrupt__?: Interrupt[] };
      interrupts.push(...values.__interrupt__ ?? []);
    }
  }
  const final = checkpoints.at(-1);
  if (!runId || !final) throw new Error('Run must emit physical identity and root checkpoint evidence');
  const exact = position(final.config.configurable);
  const saved = await api.threads.getState(threadId, exact);
  expect(position(saved.checkpoint)).toEqual(exact);
  expect(saved.values).toEqual(final.values);
  expect(saved.next).toEqual(final.next);
  const physical = await api.runs.get(threadId, runId);
  expect(physical.run_id).toBe(runId);
  expect(physical.thread_id).toBe(threadId);
  return { runId, checkpoints, interrupts, final, exact, saved, physical };
}

function owned(result: Awaited<ReturnType<typeof run>>) {
  expect(result.final.config.configurable?.['run_id']).toBe(result.runId);
  expect(result.saved.metadata?.['run_id']).toBe(result.runId);
}

function complete(saved: ThreadState<State>) {
  expect(saved.next).toEqual([]);
  expect(saved.tasks).toEqual([]);
}

test('checkpoint resume: rejection retains the paused branch after a competing approval completes', async () => {
  const api = new Client<State>({
    apiUrl: environment('INTERRUPTS_API_URL'), apiKey: null,
    callerOptions: { maxRetries: 0 }, timeoutMs: 20_000,
  });
  const { thread_id: threadId } = await api.threads.create();
  try {
    const before = (await modelJournal()).length;
    const paused = await run(api, threadId, { initial: true });
    // Locked LangGraph 1.1.6 / API 0.7.96 marks a paused physical run successful;
    // pending task and interrupt evidence distinguish this from graph completion.
    expect(paused.physical.status).toBe('success');
    owned(paused);
    expect(paused.saved.values).toEqual({
      ...draft,
      messages: [
        expect.objectContaining({ id: 'paused-checkpoint-question', type: 'human', content: prompt }),
        expect.objectContaining({ type: 'ai', content: acknowledgment }),
      ],
    });
    expect(paused.saved.next).toEqual(['request_approval']);
    expect(paused.saved.tasks).toHaveLength(1);
    const task = paused.saved.tasks[0];
    expect(task).toMatchObject({ id: expect.stringMatching(/\S/), name: 'request_approval', error: null, result: null });
    expect(paused.final.tasks).toEqual([expect.objectContaining({ id: task.id, name: task.name })]);
    expect(task.interrupts).toEqual([{ id: expect.stringMatching(/\S/), value: { kind: 'refund_approval', ...draft } }]);
    expect(paused.interrupts).toEqual(task.interrupts);
    const initialRequests = (await modelJournal()).slice(before);
    expect(initialRequests).toHaveLength(2);
    expect(initialRequests[0].body?.response_format?.type).toBe('json_schema');
    expect(initialRequests[1].body?.messages).toContainEqual(expect.objectContaining({
      role: 'system', content: expect.stringContaining('Refund Authorization Assistant'),
    }));

    // A consumed interrupt retains its first resume value in this locked backend:
    // resuming the SAME task twice does not select an alternative decision.
    // Fork B first so its approval cannot consume A's pending interrupt.
    const fork = position((await api.threads.updateState(threadId, {
      checkpoint: paused.exact, values: { amount: editedAmount }, asNode: 'draft',
      signal: AbortSignal.timeout(10_000),
    })).configurable);
    expect(fork.thread_id).toBe(threadId);
    expect(fork.checkpoint_id).not.toBe(paused.exact.checkpoint_id);
    const forked = await api.threads.getState(threadId, fork);
    expect(position(forked.checkpoint)).toEqual(fork);
    expect(position(forked.parent_checkpoint ?? undefined)).toEqual(paused.exact);
    expect(forked.values).toEqual({ ...paused.saved.values, amount: editedAmount });
    expect(forked.next).toEqual(['request_approval']);
    // The new task has not run interrupt() yet. Direct command resume supplies
    // its first decision without re-running the model-backed draft node.
    expect(forked.tasks).toEqual([expect.objectContaining({ name: 'request_approval', error: null, result: null, interrupts: [] })]);
    expect(forked.tasks[0].id).not.toBe(task.id);
    expect(await modelJournal()).toHaveLength(before + 2);

    const approved = await run(api, threadId, { checkpoint: fork, resume: { approved: true, amount: editedAmount } });
    expect(approved.physical.status).toBe('success');
    owned(approved);
    complete(approved.saved);
    expect(approved.interrupts).toEqual([]);
    expect(approved.runId).not.toBe(paused.runId);
    expect([paused.exact.checkpoint_id, fork.checkpoint_id]).not.toContain(approved.exact.checkpoint_id);
    expect(approved.saved.values).toEqual({
      ...draft, amount: editedAmount, decision_approved: true, refund_id: 're_demo__a8x2k',
      messages: [...paused.saved.values.messages, expect.objectContaining({ type: 'ai', content: issued })],
    });
    const approvedDescendants = [fork.checkpoint_id, ...approved.checkpoints.map((event) => position(event.config.configurable).checkpoint_id)];
    expect(approvedDescendants).toContain(approved.exact.checkpoint_id);
    expect(await modelJournal()).toHaveLength(before + 2);
    // Global tip establishes the competing branch setup only; it never supplies
    // routing or acceptance evidence for the rejection below.
    expect(position((await api.threads.getState(threadId)).checkpoint)).toEqual(approved.exact);
    // A must still own an unconsumed interrupt immediately before its resume.
    const stillPaused = await api.threads.getState(threadId, paused.exact);
    expect(position(stillPaused.checkpoint)).toEqual(paused.exact);
    expect(stillPaused.values).toEqual(paused.saved.values);
    expect(stillPaused.next).toEqual(['request_approval']);
    expect(stillPaused.tasks).toEqual([expect.objectContaining({
      id: task.id, name: task.name, error: null, result: null, interrupts: task.interrupts,
    })]);

    const rejected = await run(api, threadId, { checkpoint: paused.exact, resume: { approved: false } });
    // Check semantics before physical correlation: omitting only the checkpoint
    // can succeed as a no-op at B, but must fail this cancellation-state check.
    expect(rejected.saved.values).toEqual({
      ...draft, decision_approved: false,
      messages: [...paused.saved.values.messages, expect.objectContaining({ type: 'ai', content: cancellation })],
    });
    complete(rejected.saved);
    expect(rejected.interrupts).toEqual([]);

    const ancestry: string[] = [];
    let ancestor = rejected.saved;
    for (let depth = 0; depth < 6; depth++) {
      const current = position(ancestor.checkpoint);
      expect(current.thread_id).toBe(threadId);
      expect(approvedDescendants).not.toContain(current.checkpoint_id);
      expect(ancestry).not.toContain(current.checkpoint_id);
      ancestry.push(current.checkpoint_id);
      if (current.checkpoint_id === paused.exact.checkpoint_id) {
        expect(current).toEqual(paused.exact);
        break;
      }
      const parent = position(ancestor.parent_checkpoint ?? undefined);
      expect(parent.thread_id).toBe(threadId);
      ancestor = await api.threads.getState(threadId, parent);
      expect(position(ancestor.checkpoint)).toEqual(parent);
    }
    expect(ancestry.at(-1)).toBe(paused.exact.checkpoint_id);
    expect(rejected.physical.status).toBe('success');
    owned(rejected);
    expect(new Set([paused.runId, approved.runId, rejected.runId]).size).toBe(3);
    expect(new Set([paused.exact.checkpoint_id, fork.checkpoint_id, approved.exact.checkpoint_id, rejected.exact.checkpoint_id]).size).toBe(4);
    expect(await modelJournal()).toHaveLength(before + 2);

    // Values and routing remain immutable. In this backend, the paused task's
    // result incorporates completed pending writes from A's rejection.
    for (const original of [paused, approved]) {
      const unchanged = await api.threads.getState(threadId, original.exact);
      expect(position(unchanged.checkpoint)).toEqual(original.exact);
      expect(unchanged.values).toEqual(original.saved.values);
      if (original === paused) {
        expect(unchanged.tasks).toEqual([expect.objectContaining({
          id: task.id, interrupts: task.interrupts,
          result: expect.objectContaining({ decision_approved: false }),
        })]);
      }
    }
  } finally {
    await api.threads.delete(threadId);
  }
});
