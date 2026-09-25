import { afterEach, describe, expect, it } from 'vitest';
import { bindingFixture } from './binding-fixture';

const fixtures: ReturnType<typeof bindingFixture>[] = [];
afterEach(async () => {
  await Promise.all(fixtures.splice(0).map((fixture) => fixture.cleanup()));
});

describe('native binding wire fixture', () => {
  it('constructs the actual owner inertly, sends full input and cancels held bytes', async () => {
    const fixture = bindingFixture();
    fixtures.push(fixture);
    const initial = fixture.session.getSnapshot();
    const release = fixture.session.subscribe(() => undefined);
    release();
    release();
    expect(fixture.exchanges).toHaveLength(0);
    expect(fixture.session.getSnapshot()).toBe(initial);
    const run = fixture.session.submit('Hello');
    const exchange = await fixture.started();
    expect(exchange.body).toEqual({
      threadId: 'native-thread',
      runId: fixture.session.getSnapshot().run?.id,
      messages: [{ id: expect.any(String), role: 'user', content: 'Hello' }],
      state: {},
      tools: [],
      context: [],
      forwardedProps: {},
    });
    const observed = fixture.changed(
      (snapshot) => JSON.stringify(snapshot.state) === '{"ready":true}'
    );
    exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: { ready: true } });
    await observed;
    expect(fixture.session.getSnapshot().state).toEqual({ ready: true });
    await fixture.session.stop();
    expect(await run).toBe('aborted');
    await exchange.closed;
    expect(exchange.aborts).toBe(1);
    await fixture.cleanup();
    expect(exchange.aborts).toBe(1);
  });
});
