import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  liveSession,
  recordSnapshots,
  startLiveBackend,
  type LiveBackend,
} from './backend';

/**
 * Pauses and answers against the refund-approval graph: a model node drafts a
 * refund, a node pauses with `interrupt()`, and a node issues the refund once
 * the pause is answered. The draft and issue nodes write to the graph state.
 */
let backend: LiveBackend;
const sessions: { dispose(): Promise<void> }[] = [];
const track = <S extends { dispose(): Promise<void> }>(session: S): S => {
  sessions.push(session);
  return session;
};

beforeAll(async () => {
  backend = await startLiveBackend({
    python: 'cockpit/langgraph/interrupts/python',
    graph: 'interrupts',
    fixtures: [
      'cockpit/langgraph/interrupts/angular/e2e/fixtures/interrupts.json',
    ],
  });
});
afterAll(async () => {
  await Promise.allSettled(sessions.map((session) => session.dispose()));
  await backend?.stop();
});

const PROMPT = 'Refund $47.50 to cus_a8x2k for a duplicate charge.';
const DRAFT =
  'Understood — a $47.50 refund to cus_a8x2k for a duplicate charge. Pausing for operator approval; no refund is issued until a human reviews and approves.';
const pauseValue = {
  kind: 'refund_approval',
  amount: 47.5,
  customer_id: 'cus_a8x2k',
  reason: 'Customer was charged twice for the same order.',
};
const wireMessages = (values: unknown) =>
  ((values as { messages?: { type: string; content: string; id: string }[] })
    .messages ?? []) as { type: string; content: string; id: string }[];

describe('a paused run', () => {
  it('settles paused, lists the interrupt with the backend id and payload, and publishes the graph state', async () => {
    const session = track(liveSession(backend));
    expect(await session.submit(PROMPT)).toBe('paused');
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe('idle');
    expect(snapshot.interrupts).toHaveLength(1);
    const [interrupt] = snapshot.interrupts;
    expect(interrupt.value).toEqual(pauseValue);
    expect(typeof interrupt.id).toBe('string');
    expect(interrupt.resumable).not.toBe(false);
    expect(
      snapshot.messages.map((message) => [message.role, message.content])
    ).toEqual([
      ['user', PROMPT],
      ['assistant', DRAFT],
    ]);
    // The pause stopped the turn: its answer is a paused delivery.
    expect(snapshot.messages[1].delivery).toMatchObject({
      phase: 'complete',
      outcome: 'paused',
    });
    // The extraction node wrote these; they are not messages.
    expect(snapshot.state).toMatchObject({
      customer_id: 'cus_a8x2k',
      amount: 47.5,
      reason: 'Customer was charged twice for the same order.',
    });
    expect(snapshot.state).not.toHaveProperty('messages');
    // A pause does not refuse a new message here; nothing blocks the input.
    expect(snapshot.inputBlocked).toBeUndefined();
    // The id the session publishes is the one the server holds.
    const saved = await backend.saved(session.threadId as string);
    expect(saved.next).toEqual(['request_approval']);
    expect(saved.tasks[0].interrupts[0]).toMatchObject({
      id: interrupt.id,
      value: pauseValue,
    });
  });

  it('stays in place through stop, and is restored whole by a reload', async () => {
    const session = track(liveSession(backend));
    expect(await session.submit(PROMPT)).toBe('paused');
    const pending = session.getSnapshot().interrupts;
    await session.stop();
    expect(session.getSnapshot().interrupts).toEqual(pending);
    const runs = await backend.client.runs.list(session.threadId as string);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).not.toBe('error');

    const reloaded = track(
      liveSession(backend, { threadId: session.threadId })
    );
    await reloaded.load?.();
    const restored = reloaded.getSnapshot();
    expect(restored.interrupts.map(({ id, value }) => ({ id, value }))).toEqual(
      pending.map(({ id, value }) => ({ id, value }))
    );
    expect(restored.messages.map((message) => message.content)).toEqual([
      PROMPT,
      DRAFT,
    ]);
    expect(restored.state).toMatchObject({ customer_id: 'cus_a8x2k' });
    // The restored pause is answerable.
    expect(
      await reloaded.resume([
        {
          interruptId: restored.interrupts[0].id,
          status: 'resolved',
          value: { approved: false },
        },
      ])
    ).toBe('success');
    expect(reloaded.getSnapshot().messages.at(-1)?.content).toBe(
      'Refund cancelled by operator. No charge issued.'
    );
    expect(reloaded.getSnapshot().state).toMatchObject({
      decision_approved: false,
    });
    expect(reloaded.getSnapshot().interrupts).toEqual([]);
  });
});

describe('resume', () => {
  it('answers the pause with a value and continues the paused graph', async () => {
    const session = track(liveSession(backend));
    await session.submit(PROMPT);
    const [interrupt] = session.getSnapshot().interrupts;
    expect(
      await session.resume([
        {
          interruptId: interrupt.id,
          status: 'resolved',
          value: { approved: true },
        },
      ])
    ).toBe('success');
    const snapshot = session.getSnapshot();
    expect(snapshot.interrupts).toEqual([]);
    expect(snapshot.messages.map((message) => message.content)).toEqual([
      PROMPT,
      DRAFT,
      'Refund of $47.50 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.',
    ]);
    expect(snapshot.state).toMatchObject({
      decision_approved: true,
      refund_id: 're_demo__a8x2k',
      amount: 47.5,
    });
    // Nothing is left streaming, and the continued turn ended in success.
    expect(
      snapshot.messages.every(
        (message) => message.delivery.phase === 'complete'
      )
    ).toBe(true);
    expect(snapshot.messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'success',
    });
  });

  it('sends a state update and a user message in the same request as the answer', async () => {
    const session = track(liveSession(backend));
    await session.submit(PROMPT);
    const [interrupt] = session.getSnapshot().interrupts;
    const runsBefore = await backend.client.runs.list(
      session.threadId as string
    );
    expect(
      await session.resume(
        [
          {
            interruptId: interrupt.id,
            status: 'resolved',
            value: { approved: true, amount: 40 },
          },
        ],
        {
          message: 'Approved at forty dollars.',
          state: { reason: 'Goodwill credit agreed by the operator.' },
        }
      )
    ).toBe('success');
    // One request: exactly one more run on the thread.
    const runs = await backend.client.runs.list(session.threadId as string);
    expect(runs).toHaveLength(runsBefore.length + 1);

    const snapshot = session.getSnapshot();
    expect(
      snapshot.messages.map((message) => [message.role, message.content])
    ).toEqual([
      ['user', PROMPT],
      ['assistant', DRAFT],
      ['user', 'Approved at forty dollars.'],
      [
        'assistant',
        'Refund of $40.00 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.',
      ],
    ]);
    // The answer reached the paused node, and the state update was merged.
    expect(snapshot.state).toMatchObject({
      decision_approved: true,
      amount: 40,
      reason: 'Goodwill credit agreed by the operator.',
    });

    // The server saved exactly that: the message once, under the id sent.
    const saved = await backend.saved(session.threadId as string);
    const messages = wireMessages(saved.values);
    expect(messages.map((message) => [message.type, message.content])).toEqual([
      ['human', PROMPT],
      ['ai', DRAFT],
      ['human', 'Approved at forty dollars.'],
      [
        'ai',
        'Refund of $40.00 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.',
      ],
    ]);
    expect(messages[2].id).toBe(snapshot.messages[2].id);
    expect((saved.values as Record<string, unknown>)['reason']).toBe(
      'Goodwill credit agreed by the operator.'
    );
  });

  it('merges run.command.update with the state it carries', async () => {
    const session = track(liveSession(backend));
    await session.submit(PROMPT);
    const [interrupt] = session.getSnapshot().interrupts;
    expect(
      await session.resume(
        [
          {
            interruptId: interrupt.id,
            status: 'resolved',
            value: { approved: false },
          },
        ],
        {
          state: { reason: 'Declined after review.' },
          run: { command: { update: { customer_id: 'cus_reviewed' } } },
        }
      )
    ).toBe('success');
    expect(session.getSnapshot().state).toMatchObject({
      decision_approved: false,
      reason: 'Declined after review.',
      customer_id: 'cus_reviewed',
    });
  });

  it('rejects a cancelled response and an unknown interrupt without sending', async () => {
    const session = track(liveSession(backend));
    await session.submit(PROMPT);
    const [interrupt] = session.getSnapshot().interrupts;
    const before = await backend.client.runs.list(session.threadId as string);
    await expect(
      session.resume([{ interruptId: interrupt.id, status: 'cancelled' }])
    ).rejects.toThrow(/cannot cancel an interrupt/);
    await expect(
      session.resume([
        { interruptId: 'not-pending', status: 'resolved', value: true },
      ])
    ).rejects.toThrow(/No pending interrupt/);
    expect(session.getSnapshot().interrupts).toHaveLength(1);
    expect(
      await backend.client.runs.list(session.threadId as string)
    ).toHaveLength(before.length);
  });
});

describe('transcript node names', () => {
  const ISSUED =
    'Refund of $47.50 issued to `cus_a8x2k`. Refund ID: `re_demo__a8x2k`.';

  /** Runs the whole refund flow and records every snapshot of the resume. */
  async function approve(transcriptNodeNames?: readonly string[]) {
    const session = track(
      liveSession(backend, transcriptNodeNames ? { transcriptNodeNames } : {})
    );
    await session.submit(PROMPT);
    const recorded = recordSnapshots(session);
    expect(
      await session.resume([
        {
          interruptId: session.getSnapshot().interrupts[0].id,
          status: 'resolved',
          value: { approved: true },
        },
      ])
    ).toBe('success');
    recorded.release();
    return { session, snapshots: recorded.snapshots };
  }
  /** The issue node's message was shown before the state that node wrote. */
  const streamedAhead = (
    snapshots: readonly ReturnType<
      ReturnType<typeof liveSession>['getSnapshot']
    >[]
  ) =>
    snapshots.some(
      (snapshot) =>
        snapshot.messages.some((message) => message.content === ISSUED) &&
        snapshot.state?.['refund_id'] === undefined
    );

  it('keeps a node outside the list out of the stream, and still shows what it saved', async () => {
    // Every node streams into the transcript by default: the issue node's
    // message arrives on the message stream, ahead of the state it wrote.
    const open = await approve();
    expect(streamedAhead(open.snapshots)).toBe(true);

    // With only the draft node listed, that streamed message is not
    // projected. It arrives with the graph state the node saved, at once.
    const filtered = await approve(['draft']);
    expect(streamedAhead(filtered.snapshots)).toBe(false);

    // Either way the transcript ends the same, because the graph saved it.
    const contents = (session: typeof open.session) =>
      session.getSnapshot().messages.map((message) => message.content);
    expect(contents(filtered.session)).toEqual([PROMPT, DRAFT, ISSUED]);
    expect(contents(open.session)).toEqual(contents(filtered.session));
    expect(filtered.session.getSnapshot().state).toMatchObject({
      refund_id: 're_demo__a8x2k',
    });
  });

  it('still streams the listed node', async () => {
    const session = track(
      liveSession(backend, { transcriptNodeNames: ['draft'] })
    );
    const recorded = recordSnapshots(session);
    expect(await session.submit(PROMPT)).toBe('paused');
    recorded.release();
    // The draft answer was shown while its delivery was still streaming.
    expect(
      recorded.snapshots.some((snapshot) =>
        snapshot.messages.some(
          (message) =>
            message.role === 'assistant' &&
            message.delivery.phase === 'streaming' &&
            message.content.length > 0
        )
      )
    ).toBe(true);
    expect(session.getSnapshot().messages.at(-1)?.content).toBe(DRAFT);
  });
});
