import { describe, expect, it, vi } from 'vitest';
import { ok } from 'node:assert/strict';
import type { CompleteOutcome } from '@threadplane/core';
import {
  EventType,
  HttpAgent,
  type BaseEvent,
  type RunAgentInput,
} from '@ag-ui/client';
import { Observable } from 'rxjs';
import { createSession, type Session } from './create-session';
import type { SessionSnapshot } from './session-observation';
import type { ApplicationState, SubmitInput } from './submit-input';
import { bindingFixture } from './testing/binding-fixture';

function present<T>(value: T | undefined): T {
  ok(value !== undefined);
  return value;
}

async function bounded<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error('Application input timed out')),
          1500
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
function submit(
  owner: Session,
  input: SubmitInput,
  options?: { signal?: AbortSignal }
) {
  return owner.submit(input, options);
}

describe('application input admission on the actual owner', () => {
  it('keeps mutable transport graphs independent of the caller, retained state and subsequent requests', async () => {
    const received: RunAgentInput[] = [];
    const run = vi.spyOn(HttpAgent.prototype, 'run').mockImplementation(
      (input) =>
        new Observable<BaseEvent>((subscriber) => {
          received.push(structuredClone(input));
          input.state.settings.levels.push(99);
          input.messages[0].content = 'transport mutation';
          subscriber.next({
            type: EventType.RUN_STARTED,
            threadId: input.threadId,
            runId: input.runId,
          });
          subscriber.next({
            type: EventType.RUN_FINISHED,
            threadId: input.threadId,
            runId: input.runId,
          });
        })
    );
    const owner = createSession({ threadId: 'owned', url: 'unused' });
    const patch = { settings: { levels: [1] } };
    try {
      expect(
        await bounded(owner.submit({ message: 'first', state: patch }))
      ).toBe('success');
      const before = owner.getSnapshot();
      expect(await bounded(owner.submit('second'))).toBe('success');
      expect(received.map((input) => input.state)).toEqual([patch, patch]);
      expect(received[1].messages.map((message) => message.content)).toEqual([
        'first',
        'second',
      ]);
      expect(owner.getSnapshot().state).toBe(before.state);
      expect(before.state).toEqual({ settings: { levels: [1] } });
      expect(patch).toEqual({ settings: { levels: [1] } });
      expect(Object.isFrozen(patch.settings.levels)).toBe(false);
    } finally {
      await owner.dispose();
      run.mockRestore();
    }
  });

  it('rejects queued input on an incoming scalar and preserves a stable listener pass', async () => {
    const fixture = bindingFixture();
    let queued: Promise<CompleteOutcome> | undefined;
    let firstView: SessionSnapshot | undefined;
    let secondView: SessionSnapshot | undefined;
    fixture.session.subscribe(() => {
      if (fixture.session.getSnapshot().state !== 7) return;
      firstView = fixture.session.getSnapshot();
      queued = fixture.session.submit({ message: 'incompatible', state: {} });
    });
    fixture.session.subscribe(() => {
      if (fixture.session.getSnapshot().state === 7)
        secondView = fixture.session.getSnapshot();
    });
    try {
      const active = fixture.session.submit('active');
      const exchange = await bounded(fixture.started());
      exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: 7 });
      await bounded(fixture.changed((snapshot) => snapshot.state === 7));
      expect(await bounded(present(queued))).toBe('error');
      expect(firstView).toBe(secondView);
      expect(fixture.session.getSnapshot()).toBe(firstView);
      expect(exchange.aborts).toBe(0);
      await fixture.session.stop();
      expect(await bounded(active)).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not admit a queued patch whose signal aborts during the same notification', async () => {
    const fixture = bindingFixture();
    const controller = new AbortController();
    let queued: Promise<CompleteOutcome> | undefined;
    fixture.session.subscribe(() => {
      if (queued) return;
      queued = fixture.session.submit(
        { message: 'queued', state: { never: true } },
        { signal: controller.signal }
      );
      controller.abort();
      throw new Error('view failure');
    });
    try {
      const active = fixture.session.submit('active');
      const exchange = await bounded(fixture.started());
      expect(await bounded(present(queued))).toBe('aborted');
      expect(exchange.body.messages.map((message) => message.content)).toEqual([
        'active',
      ]);
      expect(exchange.body.state).toEqual({});
      expect(exchange.aborts).toBe(0);
      await fixture.session.stop();
      expect(await bounded(active)).toBe('aborted');
    } finally {
      await fixture.cleanup();
    }
  });

  it('publishes message, shallow state, fresh run and cleared children atomically', async () => {
    const fixture = bindingFixture({
      state: { keep: { n: 1 }, settings: { old: true } },
    });
    try {
      const before = fixture.session.getSnapshot();
      const seen: SessionSnapshot[] = [];
      fixture.session.subscribe(() => seen.push(fixture.session.getSnapshot()));
      const patch = { settings: { next: [2] }, model: 'small' };
      const done = submit(fixture.session, { message: ' \n ', state: patch });
      const admitted = fixture.session.getSnapshot();
      expect(admitted).toMatchObject({
        status: 'running',
        transcript: [{ role: 'user', content: ' \n ' }],
        state: { keep: { n: 1 }, settings: { next: [2] }, model: 'small' },
        subagents: [],
      });
      expect(admitted.run?.id).toEqual(expect.any(String));
      expect((admitted.state as ApplicationState)['keep']).toBe(
        (before.state as ApplicationState)['keep']
      );
      expect(seen).toEqual([admitted]);
      patch.settings.next.push(3);
      const exchange = await bounded(fixture.started());
      expect(exchange.body.state).toEqual({
        keep: { n: 1 },
        settings: { next: [2] },
        model: 'small',
      });
      await fixture.session.stop();
      expect(await bounded(done)).toBe('aborted');
      expect(fixture.session.getSnapshot().state).toBe(admitted.state);
      expect(fixture.session.getSnapshot().transcript).toBe(
        admitted.transcript
      );
    } finally {
      await fixture.cleanup();
    }
  });

  it('captures before deferral and merges ordinary queued commands in order against latest state', async () => {
    const fixture = bindingFixture({ state: { seed: true } });
    const queued: Promise<CompleteOutcome>[] = [];
    const seen: SessionSnapshot[] = [];
    let scheduled = false;
    fixture.session.subscribe(() => {
      seen.push(fixture.session.getSnapshot());
      if (scheduled) return;
      scheduled = true;
      const state = { first: { values: [1] } };
      queued.push(submit(fixture.session, { message: 'queued one', state }));
      state.first.values.push(99);
      queued.push(
        submit(fixture.session, { message: 'queued two', state: { second: 2 } })
      );
    });
    try {
      const initial = fixture.session.submit('trigger');
      const exchange = await bounded(fixture.started());
      expect(exchange.body.messages.map((message) => message.content)).toEqual([
        'trigger',
        'queued one',
        'queued two',
      ]);
      expect(exchange.body.state).toEqual({
        seed: true,
        first: { values: [1] },
        second: 2,
      });
      const admissions = seen.filter(
        (snapshot) => snapshot.status === 'running'
      );
      expect(admissions.map((snapshot) => snapshot.transcript.length)).toEqual([
        1, 2, 3,
      ]);
      expect(admissions[1].state).toEqual({
        seed: true,
        first: { values: [1] },
      });
      expect(admissions[2].state).toEqual(exchange.body.state);
      expect(await bounded(initial)).toBe('aborted');
      expect(await bounded(queued[0])).toBe('aborted');
      await fixture.session.stop();
      expect(await bounded(queued[1])).toBe('aborted');
      expect(fixture.exchanges).toHaveLength(1);
    } finally {
      await fixture.cleanup();
    }
  });

  it.each([null, [], new Date(), { bad: () => 1 }])(
    'rejects invalid patch %j without cancelling or publishing',
    async (state) => {
      const fixture = bindingFixture();
      try {
        const active = fixture.session.submit('active');
        const exchange = await bounded(fixture.started());
        const before = fixture.session.getSnapshot();
        const notify = vi.fn();
        fixture.session.subscribe(notify);
        expect(
          await bounded(
            submit(fixture.session, {
              message: 'bad',
              state,
            } as unknown as SubmitInput)
          )
        ).toBe('error');
        expect(fixture.session.getSnapshot()).toBe(before);
        expect(notify).not.toHaveBeenCalled();
        expect(exchange.aborts).toBe(0);
        expect(fixture.exchanges).toHaveLength(1);
        await fixture.session.stop();
        expect(await bounded(active)).toBe('aborted');
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each([null, 0, false, '', [1]])(
    'rejects even an empty patch against incoming literal state %j but permits omission',
    async (value) => {
      const fixture = bindingFixture();
      try {
        const active = fixture.session.submit('active');
        const exchange = await bounded(fixture.started());
        exchange.emit({ type: 'STATE_SNAPSHOT', snapshot: value });
        await bounded(
          fixture.changed(
            (snapshot) =>
              JSON.stringify(snapshot.state) === JSON.stringify(value)
          )
        );
        const before = fixture.session.getSnapshot();
        expect(
          await bounded(submit(fixture.session, { message: 'bad', state: {} }))
        ).toBe('error');
        expect(fixture.session.getSnapshot()).toBe(before);
        expect(exchange.aborts).toBe(0);
        const next = submit(fixture.session, { message: '', state: undefined });
        const second = await bounded(fixture.started(1));
        expect(second.body.state).toEqual(value);
        expect(second.body.messages.at(-1)?.content).toBe('');
        expect(await bounded(active)).toBe('aborted');
        await fixture.session.stop();
        expect(await bounded(next)).toBe('aborted');
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it.each(['stop', 'dispose', 'submit'] as const)(
    'gives reentrant %s precedence even if a nested getter throws',
    async (command) => {
      const fixture = bindingFixture();
      let inner: Promise<unknown> | undefined;
      const state = {
        get nested(): never {
          inner =
            command === 'submit'
              ? fixture.session.submit('newer')
              : fixture.session[command]();
          throw new Error('after reentry');
        },
      };
      try {
        expect(
          await bounded(submit(fixture.session, { message: 'older', state }))
        ).toBe('aborted');
        if (command === 'submit') {
          const exchange = await bounded(fixture.started());
          expect(
            exchange.body.messages.map((message) => message.content)
          ).toEqual(['newer']);
          await fixture.session.stop();
          expect(await bounded(present(inner))).toBe('aborted');
        } else {
          await bounded(present(inner));
          expect(fixture.exchanges).toHaveLength(0);
          expect(fixture.session.getSnapshot().transcript).toEqual([]);
        }
      } finally {
        await fixture.cleanup();
      }
    }
  );

  it('gives a throwing reentrant signal getter cancellation precedence', async () => {
    const fixture = bindingFixture();
    const input = {
      get message(): never {
        throw new Error('input must stay unread');
      },
    };
    try {
      expect(
        await bounded(
          submit(fixture.session, input, {
            get signal(): never {
              void fixture.session.dispose();
              throw new Error('after dispose');
            },
          })
        )
      ).toBe('aborted');
      expect(fixture.exchanges).toHaveLength(0);
    } finally {
      await fixture.cleanup();
    }
  });

  it('does not read input for pre-aborted or disposed calls and ignores transport-looking extras', async () => {
    const fixture = bindingFixture();
    const unread = vi.fn((): never => {
      throw new Error('unread');
    });
    const controller = new AbortController();
    controller.abort();
    try {
      expect(
        await submit(
          fixture.session,
          {
            get message() {
              return unread();
            },
          },
          { signal: controller.signal }
        )
      ).toBe('aborted');
      const done = submit(fixture.session, {
        message: 'valid',
        state: { messages: ['payload'] },
        get threadId() {
          return unread();
        },
      } as SubmitInput);
      const exchange = await bounded(fixture.started());
      expect(exchange.body.threadId).toBe('native-thread');
      expect(exchange.body.state).toEqual({ messages: ['payload'] });
      await fixture.session.dispose();
      expect(await bounded(done)).toBe('aborted');
      expect(
        await submit(fixture.session, {
          get message() {
            return unread();
          },
        })
      ).toBe('aborted');
      expect(unread).not.toHaveBeenCalled();
    } finally {
      await fixture.cleanup();
    }
  });
});
