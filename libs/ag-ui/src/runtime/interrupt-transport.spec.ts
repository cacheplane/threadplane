import { describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { decisionState } from './decision';
import type { InterruptTransport } from './interrupt-mode';
import { bindingFixture } from './testing/binding-fixture';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;
const finish = (exchange: Exchange, outcome?: unknown) =>
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
    ...(outcome !== undefined && { outcome }),
  });
const notice = (exchange: Exchange, value: unknown) =>
  exchange.emit({ type: 'CUSTOM', name: 'on_interrupt', value });

/** Submits, sends a notice and an ordinary finish, and returns the pause. */
async function noticed(fixture: Fixture, value: unknown, index = 0) {
  const paused = fixture.session.submit('Go');
  const exchange = await fixture.started(index);
  notice(exchange, value);
  finish(exchange);
  expect(await paused).toBe('paused');
  const snapshot = fixture.session.getSnapshot();
  const [interrupt] = snapshot.interrupts ?? [];
  if (!interrupt) throw new Error('No interrupt was published.');
  return { exchange, snapshot, interrupt };
}

describe('interruptTransport', () => {
  it("answers a notice as forwardedProps.command.resume under 'auto'", async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    const session = fixture.session;
    try {
      const { snapshot, interrupt } = await noticed(
        fixture,
        JSON.stringify({ question: 'Proceed?' })
      );
      // The run finished in the ordinary way, and the session is paused.
      expect(snapshot).toMatchObject({
        status: 'idle',
        inputBlocked: 'decision',
      });
      expect(snapshot.run?.outcome).toBe('paused');
      expect(interrupt).toMatchObject({
        reason: 'on_interrupt',
        value: { question: 'Proceed?' },
      });
      expect(Object.isFrozen(interrupt.value)).toBe(true);
      expect(decisionState(snapshot)).toMatchObject({
        kind: 'native',
        phase: 'ready',
      });
      expect(await session.submit('Bypass')).toBe('error');

      const answered = session.resume([
        {
          interruptId: interrupt.id,
          status: 'resolved',
          value: { approved: true },
        },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({
        command: { resume: { approved: true } },
      });
      expect('resume' in second.body).toBe(false);
      // No message is added for an answer.
      expect(second.body.messages).toHaveLength(1);
      expect(session.getSnapshot().interrupts).toBeUndefined();
      finish(second);
      expect(await answered).toBe('success');
      const done = session.getSnapshot();
      expect(done.decision).toBeUndefined();
      expect(done.inputBlocked).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it("uses the Mastra shape under 'auto' when the notice names a tool call", async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    try {
      const { interrupt } = await noticed(fixture, {
        toolCallId: 'tc-1',
        runId: 'mastra-run',
      });
      expect(interrupt.toolCallId).toBe('tc-1');
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: 'tuesday' },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({
        command: {
          resume: 'tuesday',
          interruptEvent: { toolCallId: 'tc-1', runId: 'mastra-run' },
        },
      });
      finish(second);
      expect(await answered).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it("names the pausing run when a 'mastra-command' notice has no run id", async () => {
    const fixture = bindingFixture({ interruptTransport: 'mastra-command' });
    try {
      const { exchange, interrupt } = await noticed(fixture, {
        toolCallId: 'tc-1',
      });
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: false },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({
        command: {
          resume: false,
          interruptEvent: { toolCallId: 'tc-1', runId: exchange.body.runId },
        },
      });
      finish(second);
      await answered;
    } finally {
      await fixture.cleanup();
    }
  });

  it("rejects a 'mastra-command' answer when the notice names no tool call", async () => {
    const fixture = bindingFixture({ interruptTransport: 'mastra-command' });
    try {
      const { interrupt } = await noticed(fixture, { question: 'Proceed?' });
      await expect(
        fixture.session.resume([
          { interruptId: interrupt.id, status: 'resolved', value: true },
        ])
      ).rejects.toThrow('Mastra interrupt requires a toolCallId');
      expect(fixture.exchanges).toHaveLength(1);
      // The pause is still there to answer.
      expect(fixture.session.getSnapshot().interrupts).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it("keeps the plain shape under 'legacy-command' even when the notice names a tool call", async () => {
    const fixture = bindingFixture({ interruptTransport: 'legacy-command' });
    try {
      const { interrupt } = await noticed(fixture, { toolCallId: 'tc-1' });
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: 1 },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({ command: { resume: 1 } });
      finish(second);
      await answered;
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a command answer that cancels, has no value or names the wrong interrupt', async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    try {
      const { interrupt } = await noticed(fixture, 'plain text');
      expect(interrupt.value).toBe('plain text');
      const { session } = fixture;
      await expect(
        session.resume([{ interruptId: interrupt.id, status: 'cancelled' }])
      ).rejects.toThrow(/cannot cancel/);
      await expect(
        session.resume([{ interruptId: interrupt.id, status: 'resolved' }])
      ).rejects.toThrow('A command resume needs a value.');
      await expect(
        session.resume([{ interruptId: 'other', status: 'resolved', value: 1 }])
      ).rejects.toThrow(/Unknown or duplicate/);
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each<InterruptTransport | undefined>([undefined, 'protocol'])(
    'leaves a notice unanswerable with transport %s',
    async (interruptTransport) => {
      const fixture = bindingFixture({ interruptTransport });
      try {
        const run = fixture.session.submit('Go');
        const first = await fixture.started();
        notice(first, { question: 'Proceed?' });
        await fixture.changed((snapshot) => snapshot.decision !== undefined);
        expect(decisionState(fixture.session.getSnapshot())).toEqual({
          kind: 'unsupported',
        });
        expect(fixture.session.getSnapshot().interrupts).toBeUndefined();
        // As before: an ordinary finish settles the run and clears the notice.
        finish(first);
        expect(await run).toBe('success');
        expect(fixture.session.getSnapshot().decision).toBeUndefined();
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it("answers the protocol's own outcome natively under 'auto', also after a notice", async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    try {
      const paused = fixture.session.submit('Go');
      const first = await fixture.started();
      notice(first, { question: 'Proceed?' });
      finish(first, {
        type: 'interrupt',
        interrupts: [{ id: 'native-1', reason: 'approval' }],
      });
      expect(await paused).toBe('paused');
      expect(fixture.session.getSnapshot().interrupts).toEqual([
        { id: 'native-1', reason: 'approval' },
      ]);
      const answered = fixture.session.resume([
        { interruptId: 'native-1', status: 'resolved', value: { ok: true } },
      ]);
      const second = await fixture.started(1);
      expect(second.body.resume).toEqual([
        { interruptId: 'native-1', status: 'resolved', payload: { ok: true } },
      ]);
      expect(second.body.forwardedProps).toEqual({});
      finish(second);
      expect(await answered).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it("answers the protocol's own outcome as a command under 'legacy-command'", async () => {
    const fixture = bindingFixture({ interruptTransport: 'legacy-command' });
    try {
      const paused = fixture.session.submit('Go');
      const first = await fixture.started();
      finish(first, {
        type: 'interrupt',
        interrupts: [{ id: 'native-1', reason: 'approval' }],
      });
      expect(await paused).toBe('paused');
      const answered = fixture.session.resume([
        { interruptId: 'native-1', status: 'resolved', value: 'yes' },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({
        command: { resume: 'yes' },
      });
      expect('resume' in second.body).toBe(false);
      finish(second);
      expect(await answered).toBe('success');
      expect(fixture.session.getSnapshot().decision).toBeUndefined();
    } finally {
      await fixture.cleanup();
    }
  });

  it('starts a new pause when the answering run sends another notice', async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    try {
      const { interrupt } = await noticed(fixture, { step: 1 });
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: 'a' },
      ]);
      const second = await fixture.started(1);
      notice(second, { step: 2 });
      finish(second);
      expect(await answered).toBe('paused');
      const [next] = fixture.session.getSnapshot().interrupts ?? [];
      expect(next.value).toEqual({ step: 2 });
      expect(next.id).not.toBe(interrupt.id);
      const again = fixture.session.resume([
        { interruptId: next.id, status: 'resolved', value: 'b' },
      ]);
      const third = await fixture.started(2);
      expect(third.body.forwardedProps).toEqual({ command: { resume: 'b' } });
      finish(third);
      expect(await again).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('leaves a sent command answer uncertain when its run ends without a terminal', async () => {
    const fixture = bindingFixture({ interruptTransport: 'auto' });
    try {
      const { interrupt } = await noticed(fixture, { step: 1 });
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: 'a' },
      ]);
      const second = await fixture.started(1);
      second.end();
      expect(await answered).toBe('interrupted');
      expect(decisionState(fixture.session.getSnapshot())).toMatchObject({
        phase: 'uncertain',
      });
      await expect(
        fixture.session.resume([
          { interruptId: interrupt.id, status: 'resolved', value: 'a' },
        ])
      ).rejects.toThrow('No interrupt is waiting for an answer.');
    } finally {
      await fixture.cleanup();
    }
  });

  it("answers a notice that closed the response under 'legacy-observation'", async () => {
    const fixture = bindingFixture({
      interruptMode: 'legacy-observation',
      interruptTransport: 'auto',
    });
    try {
      const paused = fixture.session.submit('Go');
      const first = await fixture.started();
      notice(first, { question: 'Proceed?' });
      expect(await paused).toBe('paused');
      const [interrupt] = fixture.session.getSnapshot().interrupts ?? [];
      const answered = fixture.session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: true },
      ]);
      const second = await fixture.started(1);
      expect(second.body.forwardedProps).toEqual({ command: { resume: true } });
      finish(second);
      expect(await answered).toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it("still answers nothing under 'legacy-observation' without a profile", async () => {
    const fixture = bindingFixture({ interruptMode: 'legacy-observation' });
    try {
      const paused = fixture.session.submit('Go');
      const first = await fixture.started();
      notice(first, { question: 'Proceed?' });
      expect(await paused).toBe('paused');
      await expect(fixture.session.resume([])).rejects.toThrow(
        'Resume needs a settled session with a pending interrupt.'
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('answers a notice through a session with client tools, keeping its unresolved call', async () => {
    const bodies: {
      messages: unknown[];
      forwardedProps?: unknown;
      runId: string;
      threadId: string;
    }[] = [];
    const replies: ((body: (typeof bodies)[number]) => unknown[])[] = [
      (body) => [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        {
          type: 'TOOL_CALL_START',
          toolCallId: 'tc-1',
          toolCallName: 'backend',
        },
        { type: 'TOOL_CALL_END', toolCallId: 'tc-1' },
        { type: 'CUSTOM', name: 'on_interrupt', value: { toolCallId: 'tc-1' } },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ],
      (body) => [
        { type: 'RUN_STARTED', threadId: body.threadId, runId: body.runId },
        {
          type: 'TOOL_CALL_RESULT',
          messageId: 'result-1',
          toolCallId: 'tc-1',
          content: 'booked',
        },
        { type: 'RUN_FINISHED', threadId: body.threadId, runId: body.runId },
      ],
    ];
    const session = createSession(
      {
        threadId: 't',
        url: 'unused',
        interruptTransport: 'auto',
        fetch: async (_url, init) => {
          const body = JSON.parse(String(init?.body));
          bodies.push(body);
          const events = replies[bodies.length - 1](body);
          return new Response(
            events
              .map((event) => `data: ${JSON.stringify(event)}\n\n`)
              .join(''),
            { headers: { 'content-type': 'text/event-stream' } }
          );
        },
      },
      { local: { description: 'local', handler: () => 1 } }
    );
    expect(await session.submit('Go')).toBe('paused');
    const snapshot = session.getSnapshot();
    expect(snapshot.clientTools.blocker).toBeUndefined();
    const [interrupt] = snapshot.interrupts ?? [];
    expect(interrupt.toolCallId).toBe('tc-1');
    expect(
      await session.resume([
        { interruptId: interrupt.id, status: 'resolved', value: 'ok' },
      ])
    ).toBe('success');
    expect(bodies[1].forwardedProps).toEqual({
      command: {
        resume: 'ok',
        interruptEvent: { toolCallId: 'tc-1', runId: bodies[0].runId },
      },
    });
    // The unresolved backend call travelled with the answer, as at a native pause.
    expect(JSON.stringify(bodies[1].messages)).toContain('tc-1');
    expect(session.getSnapshot().decision).toBeUndefined();
    expect(session.getSnapshot().clientTools.blocker).toBeUndefined();
    await session.dispose();
  });
});
