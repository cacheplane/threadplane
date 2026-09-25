import { describe, expect, it, vi } from 'vitest';
import { bindingFixture } from './testing/binding-fixture';
import type { NativeResponse, PauseId } from './decision';
import type { CompleteOutcome } from '@threadplane/core';
import { createSession } from './create-session';
import type { RunAgentInput } from '@ag-ui/client';

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Resume milestone timed out')),
          1500
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function currentPause(fixture: ReturnType<typeof bindingFixture>): PauseId {
  const value = fixture.session.getSnapshot().decision;
  if (value?.kind !== 'native')
    throw new Error('Expected native pause generation');
  return value.id;
}
async function pause(fixture: ReturnType<typeof bindingFixture>) {
  const done = fixture.session.submit({
    message: 'First',
    state: { setting: 'owned' },
  });
  const exchange = await bounded(fixture.started());
  exchange.emit({
    type: 'RUN_FINISHED',
    threadId: exchange.body.threadId,
    runId: exchange.body.runId,
    outcome: {
      type: 'interrupt',
      interrupts: [
        { id: 'approval', reason: 'Approve', responseSchema: { opaque: true } },
      ],
    },
  });
  expect(await bounded(done)).toBe('paused');
  await bounded(exchange.closed);
  return currentPause(fixture);
}

describe('native decision owner', () => {
  it('rejects a real foreign owner token without changing either owner', async () => {
    const first = bindingFixture(),
      second = bindingFixture();
    try {
      const firstToken = await pause(first),
        secondToken = await pause(second);
      expect(firstToken).not.toBe(secondToken);
      const before = first.session.getSnapshot(),
        other = second.session.getSnapshot();
      expect(
        await first.session.resume(secondToken, [
          { interruptId: 'approval', status: 'resolved' },
        ])
      ).toBe('error');
      expect(first.session.getSnapshot()).toBe(before);
      expect(second.session.getSnapshot()).toBe(other);
      expect(first.exchanges).toHaveLength(1);
      expect(second.exchanges).toHaveLength(1);
    } finally {
      await first.cleanup();
      await second.cleanup();
    }
  });

  it('rechecks expiry after selected caller reads and before admission', async () => {
    const fixture = bindingFixture();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    try {
      const first = fixture.session.submit('First');
      const exchange = await bounded(fixture.started());
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
        outcome: {
          type: 'interrupt',
          interrupts: [
            {
              id: 'approval',
              reason: 'Approve',
              expiresAt: new Date(2000).toISOString(),
            },
          ],
        },
      });
      expect(await bounded(first)).toBe('paused');
      await bounded(exchange.closed);
      const before = fixture.session.getSnapshot();
      expect(
        await fixture.session.resume(currentPause(fixture), [
          {
            interruptId: 'approval',
            status: 'resolved',
            get payload() {
              now.mockReturnValue(2000);
              return null;
            },
          },
        ])
      ).toBe('error');
      expect(fixture.session.getSnapshot()).toBe(before);
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      now.mockRestore();
      await fixture.cleanup();
    }
  });

  it('does not publish a claim when a queued resume signal aborts before admission', async () => {
    const fixture = bindingFixture();
    const controller = new AbortController();
    let pending: Promise<CompleteOutcome> | undefined;
    fixture.session.subscribe(() => {
      const snapshot = fixture.session.getSnapshot();
      if (
        !pending &&
        snapshot.run?.outcome === 'paused' &&
        snapshot.decision?.kind === 'native'
      ) {
        pending = fixture.session.resume(
          snapshot.decision.id,
          [{ interruptId: 'approval', status: 'resolved' }],
          { signal: controller.signal }
        );
        controller.abort();
      }
    });
    try {
      await pause(fixture);
      if (!pending) throw new Error('Missing queued resume');
      expect(await bounded(pending)).toBe('aborted');
      const decision = fixture.session.getSnapshot().decision;
      expect(decision?.kind === 'native' && decision.attempt).toBeUndefined();
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects foreign tokens, invalid batches and pre-aborted input without reads, publication or dispatch', async () => {
    const fixture = bindingFixture();
    try {
      const token = await pause(fixture);
      const before = fixture.session.getSnapshot();
      const notify = vi.fn();
      fixture.session.subscribe(notify);
      for (const responses of [
        [],
        [{ interruptId: 'other', status: 'resolved' }],
        [
          { interruptId: 'approval', status: 'resolved' },
          { interruptId: 'approval', status: 'cancelled' },
        ],
        [{ interruptId: 'approval', status: 'cancelled', payload: null }],
      ] as unknown as readonly NativeResponse[][])
        expect(await fixture.session.resume(token, responses)).toBe('error');
      expect(
        await fixture.session.resume('foreign' as PauseId, [
          { interruptId: 'approval', status: 'resolved' },
        ])
      ).toBe('error');
      const unread = vi.fn((): never => {
        throw new Error('unread');
      });
      const responses: readonly NativeResponse[] = [
        {
          get interruptId() {
            return unread();
          },
          status: 'resolved',
        },
      ];
      expect(
        await fixture.session.resume(token, responses, {
          signal: AbortSignal.abort(),
        })
      ).toBe('aborted');
      expect(fixture.session.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
      expect(fixture.exchanges).toHaveLength(1);
      await fixture.session.dispose();
      expect(await fixture.session.resume(token, responses)).toBe('aborted');
      expect(unread).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('captures selected option/input getters once and ignores extra getters', async () => {
    const fixture = bindingFixture();
    try {
      const token = await pause(fixture);
      const signal = new AbortController().signal;
      const selected = vi.fn(() => signal);
      const ignored = vi.fn((): never => {
        throw new Error('ignored');
      });
      const options = {
        get signal() {
          return selected();
        },
        get state() {
          return ignored();
        },
      };
      const response = {
        interruptId: 'approval',
        status: 'resolved' as const,
        payload: null,
        get forwardedProps() {
          return ignored();
        },
      };
      const done = fixture.session.resume(token, [response], options);
      const exchange = await bounded(fixture.started(1));
      expect(exchange.body.resume).toEqual([
        { interruptId: 'approval', status: 'resolved', payload: null },
      ]);
      expect(selected).toHaveBeenCalledTimes(1);
      expect(ignored).not.toHaveBeenCalled();
      await fixture.session.stop();
      expect(await bounded(done)).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });

  it('retains cancellation precedence when a selected signal getter disposes then throws', async () => {
    const fixture = bindingFixture();
    try {
      const token = await pause(fixture);
      const unread = vi.fn((): never => {
        throw new Error('unread');
      });
      expect(
        await fixture.session.resume(
          token,
          [
            {
              get interruptId() {
                return unread();
              },
              status: 'resolved',
            },
          ],
          {
            get signal(): never {
              void fixture.session.dispose();
              throw new Error('after dispose');
            },
          }
        )
      ).toBe('aborted');
      expect(unread).not.toHaveBeenCalled();
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(['stop', 'throw'] as const)(
    'retains an uncertain claim when eager custom fetch synchronously %s',
    async (action) => {
      let calls = 0;
      const owner = createSession({
        threadId: 'thread',
        url: 'http://unused.invalid',
        fetch: (_url, init) => {
          calls++;
          const input = JSON.parse(String(init?.body)) as RunAgentInput;
          if (calls === 1)
            return Promise.resolve(
              new Response(
                [
                  {
                    type: 'RUN_STARTED',
                    threadId: 'thread',
                    runId: input.runId,
                  },
                  {
                    type: 'RUN_FINISHED',
                    threadId: 'thread',
                    runId: input.runId,
                    outcome: {
                      type: 'interrupt',
                      interrupts: [{ id: 'approval', reason: 'Approve' }],
                    },
                  },
                ]
                  .map((event) => `data: ${JSON.stringify(event)}\n\n`)
                  .join(''),
                { headers: { 'content-type': 'text/event-stream' } }
              )
            );
          if (action === 'throw')
            throw {
              requestNotDispatched: true,
              message: 'untrusted transport claim',
            };
          void owner.stop();
          return Promise.resolve(
            new Response('', {
              headers: { 'content-type': 'text/event-stream' },
            })
          );
        },
      });
      try {
        expect(await bounded(owner.submit('First'))).toBe('paused');
        const decision = owner.getSnapshot().decision;
        if (decision?.kind !== 'native')
          throw new Error('Missing native decision');
        expect(
          await bounded(
            owner.resume(decision.id, [
              { interruptId: 'approval', status: 'resolved', payload: null },
            ])
          )
        ).toBe(action === 'stop' ? 'aborted' : 'error');
        expect(owner.getSnapshot().decision).toMatchObject({
          kind: 'native',
          id: decision.id,
          attempt: { runId: owner.getSnapshot().run?.id },
        });
        expect(
          await owner.resume(decision.id, [
            { interruptId: 'approval', status: 'resolved' },
          ])
        ).toBe('error');
        expect(await owner.submit('bypass')).toBe('error');
        expect(calls).toBe(2);
      } finally {
        await owner.dispose();
      }
    }
  );

  it('admits one captured response without a user row and preserves state/history references', async () => {
    const fixture = bindingFixture();
    try {
      const token = await pause(fixture);
      const before = fixture.session.getSnapshot();
      const payload = { values: [1] };
      const done = fixture.session.resume(token, [
        { interruptId: 'approval', status: 'resolved', payload },
      ]);
      payload.values.push(99);
      const admitted = fixture.session.getSnapshot();
      expect(admitted.state).toBe(before.state);
      expect(admitted.transcript).toBe(before.transcript);
      expect(admitted.run?.id).not.toBe(before.run?.id);
      expect(admitted.run?.terminal).toBeUndefined();
      expect(admitted.decision).toMatchObject({
        kind: 'native',
        id: token,
        attempt: {
          runId: admitted.run?.id,
          responses: [
            {
              interruptId: 'approval',
              status: 'resolved',
              payload: { values: [1] },
            },
          ],
        },
      });
      expect(
        await fixture.session.resume(token, [
          { interruptId: 'approval', status: 'cancelled' },
        ])
      ).toBe('error');
      const unread = vi.fn((): never => {
        throw new Error('unread');
      });
      expect(
        await fixture.session.submit({
          get message() {
            return unread();
          },
        })
      ).toBe('error');
      expect(unread).not.toHaveBeenCalled();
      const exchange = await bounded(fixture.started(1));
      expect(exchange.body).toStrictEqual({
        threadId: 'native-thread',
        runId: admitted.run?.id,
        messages: [
          { id: before.transcript[0].id, role: 'user', content: 'First' },
        ],
        state: { setting: 'owned' },
        resume: [
          {
            interruptId: 'approval',
            status: 'resolved',
            payload: { values: [1] },
          },
        ],
        tools: [],
        context: [],
        forwardedProps: {},
      });
      exchange.emit({
        type: 'RUN_FINISHED',
        threadId: exchange.body.threadId,
        runId: exchange.body.runId,
      });
      expect(await bounded(done)).toBe('success');
      expect(fixture.session.getSnapshot().decision).toBeUndefined();
      expect(before.decision?.kind).toBe('native');
    } finally {
      await fixture.cleanup();
    }
  });

  it('rejects a terminal-listener resume before settlement instead of queueing it', async () => {
    const fixture = bindingFixture();
    let attempted: Promise<CompleteOutcome> | undefined;
    fixture.session.subscribe(() => {
      const snapshot = fixture.session.getSnapshot();
      if (
        !attempted &&
        snapshot.run?.terminal?.type === 'RUN_FINISHED' &&
        snapshot.decision?.kind === 'native'
      )
        attempted = fixture.session.resume(snapshot.decision.id, [
          { interruptId: 'approval', status: 'resolved' },
        ]);
    });
    try {
      await pause(fixture);
      if (!attempted) throw new Error('Missing terminal callback attempt');
      expect(await bounded(attempted)).toBe('error');
      expect(fixture.exchanges).toHaveLength(1);
      expect(fixture.session.getSnapshot().decision?.kind).toBe('native');
    } finally {
      await fixture.cleanup();
    }
  });

  it('captures notification-queued responses immediately and admits only one of two observers', async () => {
    const fixture = bindingFixture();
    const attempts: Promise<CompleteOutcome>[] = [];
    let scheduled = false;
    fixture.session.subscribe(() => {
      const snapshot = fixture.session.getSnapshot();
      if (
        scheduled ||
        snapshot.run?.outcome !== 'paused' ||
        snapshot.decision?.kind !== 'native'
      )
        return;
      scheduled = true;
      const payload = { values: [1] };
      attempts.push(
        fixture.session.resume(snapshot.decision.id, [
          { interruptId: 'approval', status: 'resolved', payload },
        ])
      );
      payload.values.push(99);
      attempts.push(
        fixture.session.resume(snapshot.decision.id, [
          { interruptId: 'approval', status: 'cancelled' },
        ])
      );
    });
    try {
      await pause(fixture);
      const exchange = await bounded(fixture.started(1));
      expect(exchange.body.resume).toEqual([
        {
          interruptId: 'approval',
          status: 'resolved',
          payload: { values: [1] },
        },
      ]);
      expect(await bounded(attempts[1])).toBe('error');
      await fixture.session.stop();
      expect(await bounded(attempts[0])).toBe('aborted');
      expect(fixture.exchanges).toHaveLength(2);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each(['stop', 'dispose', 'resume'] as const)(
    'rejects an outer capture after a throwing payload getter reenters %s',
    async (command) => {
      const fixture = bindingFixture();
      let inner: Promise<unknown> = Promise.resolve();
      try {
        const token = await pause(fixture);
        const responses: readonly NativeResponse[] = [
          {
            interruptId: 'approval',
            status: 'resolved',
            get payload(): never {
              inner =
                command === 'resume'
                  ? fixture.session.resume(token, [
                      { interruptId: 'approval', status: 'cancelled' },
                    ])
                  : fixture.session[command]();
              throw new Error('after reentry');
            },
          },
        ];
        expect(await fixture.session.resume(token, responses)).toBe('aborted');
        if (command === 'resume') {
          const exchange = await bounded(fixture.started(1));
          expect(exchange.body.resume).toEqual([
            { interruptId: 'approval', status: 'cancelled' },
          ]);
          await fixture.session.stop();
          expect(await bounded(inner)).toBe('aborted');
        } else {
          await inner;
          expect(fixture.exchanges).toHaveLength(1);
        }
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('releases a claim stopped synchronously at admission before dispatch, then allows the same generation', async () => {
    const fixture = bindingFixture();
    let stopped = false;
    try {
      const token = await pause(fixture);
      fixture.session.subscribe(() => {
        const decision = fixture.session.getSnapshot().decision;
        if (!stopped && decision?.kind === 'native' && decision.attempt) {
          stopped = true;
          void fixture.session.stop();
        }
      });
      expect(
        await fixture.session.resume(token, [
          { interruptId: 'approval', status: 'resolved' },
        ])
      ).toBe('aborted');
      expect(fixture.exchanges).toHaveLength(1);
      const decision = fixture.session.getSnapshot().decision;
      expect(decision).toMatchObject({ id: token, kind: 'native' });
      if (decision?.kind !== 'native')
        throw new Error('Lost original decision');
      expect(decision.attempt).toBeUndefined();
      expect(fixture.session.getSnapshot().run?.id).not.toBe(
        decision.sourceRunId
      );
      const retry = fixture.session.resume(token, [
        { interruptId: 'approval', status: 'resolved' },
      ]);
      await bounded(fixture.started(1));
      await fixture.session.stop();
      expect(await bounded(retry)).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });
});
