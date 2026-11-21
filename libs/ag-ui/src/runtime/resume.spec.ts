import { PROTOCOL_VERSION } from '@ag-ui/client';
import { describe, expect, it, vi } from 'vitest';
import { bindingFixture } from './testing/binding-fixture';
import type { InterruptResponse, PauseId } from './decision';
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
      const expired = fixture.session.resume([
        {
          interruptId: 'approval',
          status: 'resolved',
          get value() {
            now.mockReturnValue(2000);
            return null;
          },
        },
      ]);
      await expect(expired).rejects.toThrow(TypeError);
      await expect(expired).rejects.toThrow('The interrupt has expired');
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

  it('rejects invalid batches, and aborts pre-aborted input without reads, publication or dispatch', async () => {
    const fixture = bindingFixture();
    try {
      await pause(fixture);
      const before = fixture.session.getSnapshot();
      const notify = vi.fn();
      fixture.session.subscribe(notify);
      for (const [responses, message] of [
        [[], 'Exactly one response per interrupt is required'],
        [
          [{ interruptId: 'other', status: 'resolved' }],
          'Unknown or duplicate interrupt response',
        ],
        [
          [
            { interruptId: 'approval', status: 'resolved' },
            { interruptId: 'approval', status: 'cancelled' },
          ],
          'Exactly one response per interrupt is required',
        ],
        [
          [{ interruptId: 'approval', status: 'cancelled', value: null }],
          'A cancelled response cannot carry a value.',
        ],
        ['approval', 'Resume takes an array of responses.'],
      ] as unknown as readonly [readonly InterruptResponse[], string?][]) {
        const refused = fixture.session.resume(responses);
        await expect(refused).rejects.toThrow(TypeError);
        if (message) await expect(refused).rejects.toThrow(message);
      }
      const unread = vi.fn((): never => {
        throw new Error('unread');
      });
      const responses: readonly InterruptResponse[] = [
        {
          get interruptId() {
            return unread();
          },
          status: 'resolved',
        },
      ];
      expect(
        await fixture.session.resume(responses, {
          signal: AbortSignal.abort(),
        })
      ).toBe('aborted');
      expect(fixture.session.getSnapshot()).toBe(before);
      expect(notify).not.toHaveBeenCalled();
      expect(fixture.exchanges).toHaveLength(1);
      await fixture.session.dispose();
      expect(await fixture.session.resume(responses)).toBe('aborted');
      expect(unread).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });

  it('captures selected option/input getters once and ignores extra getters', async () => {
    const fixture = bindingFixture();
    try {
      await pause(fixture);
      const signal = new AbortController().signal;
      const selected = vi.fn(() => signal);
      const ignored = vi.fn((): never => {
        throw new Error('ignored');
      });
      const options = {
        get signal() {
          return selected();
        },
        get forwardedProps() {
          return ignored();
        },
      };
      const response = {
        interruptId: 'approval',
        status: 'resolved' as const,
        value: null,
        get forwardedProps() {
          return ignored();
        },
      };
      const done = fixture.session.resume([response], options);
      const exchange = await bounded(fixture.started(1));
      // 1.0 client rule: a whole-optional `payload: null` is sent as absent.
      expect(exchange.body.resume).toStrictEqual([
        { interruptId: 'approval', status: 'resolved' },
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
      await pause(fixture);
      const unread = vi.fn((): never => {
        throw new Error('unread');
      });
      expect(
        await fixture.session.resume(
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
            owner.resume([
              { interruptId: 'approval', status: 'resolved', value: null },
            ])
          )
        ).toBe(action === 'stop' ? 'aborted' : 'error');
        expect(owner.getSnapshot().decision).toMatchObject({
          kind: 'native',
          id: decision.id,
          attempt: { runId: owner.getSnapshot().run?.id },
        });
        await expect(
          owner.resume([{ interruptId: 'approval', status: 'resolved' }])
        ).rejects.toThrow('No interrupt is waiting for an answer.');
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
      const done = fixture.session.resume([
        { interruptId: 'approval', status: 'resolved', value: payload },
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
      await expect(
        fixture.session.resume([
          { interruptId: 'approval', status: 'cancelled' },
        ])
      ).rejects.toThrow(
        'Resume needs a settled session with a pending interrupt.'
      );
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
        protocolVersion: PROTOCOL_VERSION,
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
      ) {
        attempted = fixture.session.resume([
          { interruptId: 'approval', status: 'resolved' },
        ]);
        // Observed below; the refusal lands before the test awaits it.
        attempted.catch(() => undefined);
      }
    });
    try {
      await pause(fixture);
      if (!attempted) throw new Error('Missing terminal callback attempt');
      await expect(bounded(attempted)).rejects.toThrow(TypeError);
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
        fixture.session.resume([
          { interruptId: 'approval', status: 'resolved', value: payload },
        ])
      );
      payload.values.push(99);
      attempts.push(
        fixture.session.resume([
          { interruptId: 'approval', status: 'cancelled' },
        ])
      );
      // Observed below; the refusal lands before the test awaits it.
      attempts[1].catch(() => undefined);
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
      await expect(bounded(attempts[1])).rejects.toThrow(TypeError);
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
        await pause(fixture);
        const responses: readonly InterruptResponse[] = [
          {
            interruptId: 'approval',
            status: 'resolved',
            get value(): never {
              inner =
                command === 'resume'
                  ? fixture.session.resume([
                      { interruptId: 'approval', status: 'cancelled' },
                    ])
                  : fixture.session[command]();
              throw new Error('after reentry');
            },
          },
        ];
        expect(await fixture.session.resume(responses)).toBe('aborted');
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
        await fixture.session.resume([
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
      const retry = fixture.session.resume([
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
