import { describe, expect, it } from 'vitest';
import { createSession } from './create-session';
import { bindingFixture } from './testing/binding-fixture';

type Fixture = ReturnType<typeof bindingFixture>;
type Exchange = Awaited<ReturnType<Fixture['started']>>;

function answer(exchange: Exchange, messageId: string, text: string) {
  exchange.emit({ type: 'TEXT_MESSAGE_START', messageId, role: 'assistant' });
  exchange.emit({ type: 'TEXT_MESSAGE_CONTENT', messageId, delta: text });
  exchange.emit({ type: 'TEXT_MESSAGE_END', messageId });
}
function finish(exchange: Exchange) {
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
  });
}
/** Calls regenerate, failing the test instead of passing when the session has none. */
function regenerateOf<T>(
  session: { regenerate?(id: string): Promise<T> },
  id: string
): Promise<T> {
  if (!session.regenerate) throw new Error('The session has no regenerate.');
  return session.regenerate(id);
}

/** Two settled turns: Rome then Paris. */
async function twoTurns(fixture: Fixture) {
  const session = fixture.session;
  const first = session.submit('Plan Rome');
  const one = await fixture.started();
  answer(one, 'rome', 'Rome plan');
  finish(one);
  await expect(first).resolves.toBe('success');
  const second = session.submit('Plan Paris');
  const two = await fixture.started(1);
  answer(two, 'paris', 'Paris plan');
  finish(two);
  await expect(second).resolves.toBe('success');
  return { session, one, two };
}

describe('regenerate', () => {
  it('answers the latest prompt again and drops the earlier answer', async () => {
    const fixture = bindingFixture();
    try {
      const { session, two } = await twoTurns(fixture);
      const regenerated = regenerateOf(session, 'paris');
      const three = await fixture.started(2);
      // The request ends with the prompt; the old answer is not sent, and no
      // second user message is added.
      expect(three.body.messages).toEqual(two.body.messages);
      expect(three.body.runId).not.toBe(two.body.runId);
      const running = session.getSnapshot();
      expect(running.status).toBe('running');
      expect(running.messages.map((message) => message.content)).toEqual([
        'Plan Rome',
        'Rome plan',
        'Plan Paris',
      ]);

      answer(three, 'paris-2', 'Another Paris plan');
      finish(three);
      await expect(regenerated).resolves.toBe('success');
      expect(
        session.getSnapshot().messages.map((message) => message.content)
      ).toEqual(['Plan Rome', 'Rome plan', 'Plan Paris', 'Another Paris plan']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('regenerates an earlier answer by dropping every turn after its prompt', async () => {
    const fixture = bindingFixture();
    try {
      const { session, one } = await twoTurns(fixture);
      const regenerated = regenerateOf(session, 'rome');
      const three = await fixture.started(2);
      expect(three.body.messages).toEqual(one.body.messages);
      expect(
        session.getSnapshot().messages.map((message) => message.content)
      ).toEqual(['Plan Rome']);
      answer(three, 'rome-2', 'Another Rome plan');
      finish(three);
      await expect(regenerated).resolves.toBe('success');
      expect(
        session.getSnapshot().messages.map((message) => message.content)
      ).toEqual(['Plan Rome', 'Another Rome plan']);
    } finally {
      await fixture.cleanup();
    }
  });

  it('regenerates an answer from a loaded thread', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
      ],
    });
    try {
      const regenerated = regenerateOf(fixture.session, 'a1');
      const exchange = await fixture.started();
      expect(exchange.body.messages).toEqual([
        { id: 'u1', role: 'user', content: 'Hello' },
      ]);
      finish(exchange);
      await expect(regenerated).resolves.toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects an unknown id, a user message, and an answer with no prompt before it, sending nothing', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'greeting', role: 'assistant', content: 'Welcome' },
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
      ],
    });
    try {
      const before = fixture.session.getSnapshot();
      await expect(regenerateOf(fixture.session, 'missing')).rejects.toThrow(
        'Regenerate needs the id of an assistant message.'
      );
      await expect(regenerateOf(fixture.session, 'u1')).rejects.toThrow(
        'Regenerate needs the id of an assistant message.'
      );
      await expect(regenerateOf(fixture.session, 'greeting')).rejects.toThrow(
        'No prompt precedes that message.'
      );
      expect(fixture.exchanges).toHaveLength(0);
      expect(fixture.session.getSnapshot()).toBe(before);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects while a response is running and leaves that run alone', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
      ],
    });
    try {
      const running = fixture.session.submit('Again');
      const exchange = await fixture.started();
      await expect(regenerateOf(fixture.session, 'a1')).rejects.toThrow(
        'Cannot regenerate while a response is running.'
      );
      expect(fixture.exchanges).toHaveLength(1);
      finish(exchange);
      await expect(running).resolves.toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects while a decision is waiting', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
      ],
    });
    try {
      const paused = fixture.session.submit('Book it');
      const exchange = await fixture.started();
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [{ id: 'approval', reason: 'Approve' }],
        },
      });
      await expect(paused).resolves.toBe('paused');
      await expect(regenerateOf(fixture.session, 'a1')).rejects.toThrow(
        'Cannot regenerate while a decision is waiting.'
      );
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects after disposal', async () => {
    const fixture = bindingFixture({
      messages: [
        { id: 'u1', role: 'user', content: 'Hello' },
        { id: 'a1', role: 'assistant', content: 'Hi' },
      ],
    });
    await fixture.session.dispose();
    await expect(regenerateOf(fixture.session, 'a1')).rejects.toThrow(
      'The session is disposed.'
    );
    expect(fixture.exchanges).toHaveLength(0);
    await fixture.cleanup();
  });

  it('lets retry send a failed regenerate again with the trimmed history', async () => {
    const fixture = bindingFixture();
    try {
      const { session, one } = await twoTurns(fixture);
      const regenerated = regenerateOf(session, 'rome');
      const three = await fixture.started(2);
      three.emit({ type: 'RUN_ERROR', message: 'Model overloaded' });
      await expect(regenerated).resolves.toBe('error');
      expect(session.getSnapshot().error?.recovery).toBe('retry');
      const retried = session.retry?.();
      const four = await fixture.started(3);
      expect(four.body.messages).toEqual(one.body.messages);
      finish(four);
      await expect(retried).resolves.toBe('success');
    } finally {
      await fixture.cleanup();
    }
  });

  it('is absent on the client-tool session', () => {
    const owner = createSession(
      { threadId: 't', url: 'https://native-fixture.invalid/run' },
      { f: { description: 'f', handler: () => 'ok' } }
    );
    expect('regenerate' in owner).toBe(false);
  });
});
