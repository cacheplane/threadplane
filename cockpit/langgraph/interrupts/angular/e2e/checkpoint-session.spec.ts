import { expect, test } from '@playwright/test';
import { Client, type Checkpoint } from '@langchain/langgraph-sdk';
import { createSession } from '../../../../../libs/langgraph/src/runtime/create-session';
import { FetchStreamTransport } from '../../../../../libs/langgraph/src/lib/transport/fetch-stream.transport';

const seedPrompt = 'Refund $129.00 to customer cus_z19fp for an unrecognized charge.';
const prompt = 'Refund $47.50 to customer cus_a8x2k — they were charged twice for the same order.';
const acknowledgment = 'Understood — a $47.50 refund to cus_a8x2k for a duplicate charge. Pausing for operator approval; no refund is issued until a human reviews and approves.';
const cancellation = 'Refund cancelled by operator. No charge issued.';
type State = {
  messages: { id: string; type: string; content: unknown }[];
  customer_id?: string;
  amount?: number;
  reason?: string;
  decision_approved?: boolean;
  refund_id?: string;
};
type Position = Checkpoint & { checkpoint_id: string };

function environment(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Global setup must expose ${name}`);
  return value;
}

function position(config: Record<string, unknown> | undefined): Position {
  if (!config) throw new Error('Expected a full root checkpoint reference');
  expect(config['thread_id']).toEqual(expect.stringMatching(/\S/));
  expect(config['checkpoint_ns']).toBe('');
  expect(config['checkpoint_id']).toEqual(expect.stringMatching(/\S/));
  const map = config['checkpoint_map'];
  if (map !== undefined) {
    expect(map).not.toBeNull();
    expect(typeof map).toBe('object');
    expect(Array.isArray(map)).toBe(false);
    for (const value of Object.values(map as object)) expect(value).toEqual(expect.any(String));
  }
  return {
    thread_id: config['thread_id'] as string, checkpoint_ns: '', checkpoint_id: config['checkpoint_id'] as string,
    // Saved state may omit the empty map echoed by checkpoint frames.
    checkpoint_map: map === undefined ? {} : { ...map as Record<string, string> },
  };
}

class ObservedTransport extends FetchStreamTransport {
  creations = 0;
  readonly checkpoints: Position[] = [];
  override async *stream(...args: Parameters<FetchStreamTransport['stream']>) {
    this.creations++;
    for await (const event of super.stream(...args)) {
      if (event.type === 'checkpoints') {
        const data = event.data as { config: { configurable?: Record<string, unknown> } };
        this.checkpoints.push(position(data.config.configurable));
      }
      yield event;
    }
  }
  finalPosition() {
    const exact = this.checkpoints.at(-1);
    if (!exact) throw new Error('Session must observe a real root checkpoint');
    return exact;
  }
}

async function run(api: Client<State>, threadId: string, checkpoint?: Position, response?: { approved: boolean; amount?: number }) {
  let exact: Position | undefined;
  let runId: string | undefined;
  for await (const event of api.runs.stream(threadId, 'interrupts', {
    input: checkpoint ? null : { messages: [{ id: 'completed-source', type: 'human', content: seedPrompt }] },
    checkpoint, command: response ? { resume: response } : undefined,
    streamMode: ['values', 'checkpoints'], signal: AbortSignal.timeout(20_000),
  })) {
    expect(event.event).not.toBe('error');
    if (event.event === 'metadata') runId = event.data.run_id;
    if (event.event === 'checkpoints') exact = position((event.data as { config: { configurable?: Record<string, unknown> } }).config.configurable);
  }
  if (!exact || !runId) throw new Error('Expected physical run and saved root checkpoint');
  const saved = await api.threads.getState(threadId, exact);
  expect(position(saved.checkpoint)).toEqual(exact);
  expect(saved.metadata?.['run_id']).toBe(runId);
  expect((await api.runs.get(threadId, runId)).status).toBe('success');
  return saved;
}

async function requests() {
  const response = await fetch(`${environment('INTERRUPTS_AIMOCK_URL')}/__aimock/journal`, { signal: AbortSignal.timeout(5_000) });
  expect(response.ok).toBe(true);
  const entries = await response.json() as { body?: { messages?: { role: string; content: unknown }[] } }[];
  return entries.filter((entry) => entry.body?.messages?.some((message) => message.role === 'user' && message.content === prompt));
}

for (const consumed of [false, true]) {
  test(`checkpoint session: ${consumed ? 'rejects a task consumed by another client before resume' : 'resumes its own unconsumed pause after a distinct branch completes'}`, async () => {
    const api = new Client<State>({
      apiUrl: environment('INTERRUPTS_API_URL'), apiKey: null, callerOptions: { maxRetries: 0 }, timeoutMs: 20_000,
    });
    const { thread_id: threadId } = await api.threads.create();
    const transport = new ObservedTransport(environment('INTERRUPTS_API_URL'), undefined, { maxRetries: 0 });
    const session = createSession({ assistantId: 'interrupts', threadId, transport });
    try {
      const firstPause = await run(api, threadId);
      const source = await run(api, threadId, position(firstPause.checkpoint), { approved: false });
      expect(source.next).toEqual([]);
      expect(source.tasks).toEqual([]);
      expect(source.values.refund_id).toBeUndefined();
      const before = (await requests()).length;
      expect(await session.fork(source.checkpoint, prompt)).toBe('paused');
      const pausedPosition = transport.finalPosition();
      const paused = await api.threads.getState(threadId, pausedPosition);
      expect(paused.values.messages.map((message) => message.content)).toEqual([
        ...source.values.messages.map((message) => message.content), prompt, acknowledgment,
      ]);
      expect(paused.next).toEqual(['request_approval']);
      expect(paused.tasks).toHaveLength(1);
      const task = paused.tasks[0];
      expect(task).toMatchObject({ id: expect.stringMatching(/\S/), name: 'request_approval', result: null });
      expect(task.interrupts).toEqual([expect.objectContaining({
        id: expect.stringMatching(/\S/),
        value: { kind: 'refund_approval', customer_id: 'cus_a8x2k', amount: 47.5, reason: 'Customer was charged twice for the same order.' },
      })]);
      expect(await requests()).toHaveLength(before + 2);
      const snapshot = session.getSnapshot();
      const beforeCreations = transport.creations;

      if (consumed) {
        const approved = await run(api, threadId, pausedPosition, { approved: true, amount: 31.25 });
        expect(approved.values.decision_approved).toBe(true);
        const reread = await api.threads.getState(threadId, pausedPosition);
        // Checkpoint values/interrupts alone conceal consumption on this backend.
        expect(reread.values).toEqual(paused.values);
        expect(reread.tasks[0]).toMatchObject({ id: task.id, interrupts: task.interrupts, result: expect.objectContaining({ decision_approved: true }) });
        const publications: ReturnType<typeof session.getSnapshot>[] = [];
        const unsubscribe = session.subscribe(() => publications.push(session.getSnapshot()));
        let rejected = false;
        try {
          await session.resume({ approved: false });
        } catch {
          rejected = true;
        } finally {
          unsubscribe();
        }
        expect(transport.creations).toBe(beforeCreations);
        expect(rejected).toBe(true);
        for (const published of publications) {
          expect(published.messages).toEqual(snapshot.messages);
          expect(published.values).toEqual(snapshot.values);
        }
        expect(session.getSnapshot().messages).toEqual(snapshot.messages);
        expect(session.getSnapshot().values).toEqual(snapshot.values);
        expect(position((await api.threads.getState(threadId)).checkpoint)).toEqual(position(approved.checkpoint));
      } else {
        const fork = position((await api.threads.updateState(threadId, {
          checkpoint: pausedPosition, values: { amount: 31.25 }, asNode: 'draft', signal: AbortSignal.timeout(10_000),
        })).configurable);
        const forked = await api.threads.getState(threadId, fork);
        expect(forked.tasks[0].id).not.toBe(task.id);
        const approved = await run(api, threadId, fork, { approved: true, amount: 31.25 });
        expect(approved.values).toMatchObject({ amount: 31.25, decision_approved: true, refund_id: 're_demo__a8x2k' });
        expect(position((await api.threads.getState(threadId)).checkpoint)).toEqual(position(approved.checkpoint));
        const stillPaused = await api.threads.getState(threadId, pausedPosition);
        expect(stillPaused.tasks).toEqual([expect.objectContaining({ id: task.id, result: null, interrupts: task.interrupts })]);
        expect(await session.resume({ approved: false })).toBe('success');
        expect(transport.creations).toBe(beforeCreations + 1);
        const exact = transport.finalPosition();
        const rejected = await api.threads.getState(threadId, exact);
        expect(rejected.values).toEqual({
          ...paused.values, decision_approved: false,
          messages: [...paused.values.messages, expect.objectContaining({ type: 'ai', content: cancellation })],
        });
        expect(rejected.values.refund_id).toBeUndefined();
        expect(rejected.next).toEqual([]);
        expect(rejected.tasks).toEqual([]);
        let ancestor = rejected;
        const visited = new Set<string>();
        for (let depth = 0; depth < 6; depth++) {
          const current = position(ancestor.checkpoint);
          expect(current.thread_id).toBe(threadId);
          expect([fork.checkpoint_id, approved.checkpoint.checkpoint_id]).not.toContain(current.checkpoint_id);
          expect(visited.has(current.checkpoint_id)).toBe(false);
          visited.add(current.checkpoint_id);
          if (current.checkpoint_id === pausedPosition.checkpoint_id) break;
          ancestor = await api.threads.getState(threadId, position(ancestor.parent_checkpoint ?? undefined));
        }
        expect(position(ancestor.checkpoint)).toEqual(pausedPosition);
        await session.load?.();
        expect(session.getSnapshot().messages.map((message) => message.content)).toEqual(rejected.values.messages.map((message) => message.content));
        expect((await api.threads.getState(threadId, position(approved.checkpoint))).values).toEqual(approved.values);
      }
      expect(await requests()).toHaveLength(before + 2);
      expect((await api.threads.getState(threadId, position(source.checkpoint))).values).toEqual(source.values);
    } finally {
      session.dispose();
      await api.threads.delete(threadId);
    }
  });
}
