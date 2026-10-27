import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { ChatInputProps } from '@threadplane/react/chat';
import type { ChatDebugProps } from '@threadplane/react/debug';
import type { DebugClient, DebugSession } from './connection';
import type { DebugSnapshot } from './authority';
import { createDebugApplication } from './application';
import { DebugDemo } from './app';
import fixture from './native-semantic.fixture.json';
(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const observed = vi.hoisted(() => ({
  inputs: [] as ChatInputProps[],
  panels: [] as ChatDebugProps[],
}));
vi.mock('@threadplane/react/chat', async (original) => {
  const actual = await original<typeof import('@threadplane/react/chat')>();
  return {
    ...actual,
    ChatInput: (props: ChatInputProps) => {
      observed.inputs.push(props);
      return <actual.ChatInput {...props} />;
    },
  };
});
vi.mock('@threadplane/react/debug', async (original) => {
  const actual = await original<typeof import('@threadplane/react/debug')>();
  return {
    ...actual,
    ChatDebug: (props: ChatDebugProps) => {
      observed.panels.push(props);
      return <actual.ChatDebug {...props} />;
    },
  };
});
const tick = async () => {
  for (let i = 0; i < 32; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup() {
  let state: DebugSnapshot = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
  };
  let run = deferred<'success'>(),
    load = deferred<void>();
  const listeners = new Set<() => void>();
  const session = {
    getSnapshot: () => state,
    subscribe: vi.fn((notify: () => void) => {
      listeners.add(notify);
      return () => {
        listeners.delete(notify);
      };
    }),
    submit: vi.fn(() => run.promise),
    resume: vi.fn(),
    load: vi.fn(() => load.promise),
    stop: vi.fn(async (): Promise<void> => undefined),
    dispose: vi.fn(async (): Promise<void> => undefined),
  };
  const client = {
    createThread: vi.fn(async () => fixture.turns[0].checkpoint.thread_id),
    sessionFactory: vi.fn(async () => session as unknown as DebugSession),
    readCurrent: vi.fn(async () => fixture.turns[0].rawExact),
    readCheckpoint: vi.fn(async () => fixture.turns[0].rawExact),
    readHistory: vi.fn(async () => [fixture.turns[0].rawExact]),
  };
  const application = createDebugApplication(client as unknown as DebugClient);
  const update = (s: DebugSnapshot) => {
    state = s;
    for (const notify of [...listeners]) notify();
  };
  const t = fixture.turns[0];
  const live = (saved = false): DebugSnapshot => ({
    status: 'idle',
    messages: t.semantic.map((m) => ({
      ...m,
      delivery: {
        generation: saved ? m.id : t.generation,
        phase: 'complete',
        outcome: 'success',
      },
    })),
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    values: { analysis: t.analysis },
    history: saved
      ? [{ checkpoint: t.checkpoint, next: [], tasks: [] }]
      : undefined,
  });
  const effects = () =>
    [
      client.createThread,
      client.sessionFactory,
      client.readCurrent,
      client.readCheckpoint,
      client.readHistory,
      session.submit,
      session.load,
      session.stop,
      session.dispose,
    ].map((fn) => fn.mock.calls.length);
  return {
    application,
    session,
    client,
    effects,
    async stream() {
      const s = live();
      update({ ...s, status: 'running', messages: s.messages.slice(0, 1) });
      await tick();
    },
    async finish() {
      update(live());
      run.resolve('success');
      await tick();
    },
    async saved() {
      update(live(true));
      load.resolve();
      await tick();
    },
    beginFollowup() {
      run = deferred<'success'>();
      load = deferred<void>();
      const turn = fixture.turns[1];
      const pending = application.submit(turn.input);
      const s: DebugSnapshot = {
        status: 'running',
        messages: turn.semantic
          .slice(0, 5)
          .map((m, i) => ({
            ...m,
            delivery: {
              generation: i < 4 ? m.id : turn.generation,
              phase: 'complete',
              outcome: 'success',
            },
          })),
        toolCalls: [],
        interrupts: [],
        subgraphs: [],
        values: { analysis: turn.analysis },
      };
      update(s);
      return pending;
    },
    async failFollowup() {
      const pending = this.beginFollowup();
      client.readCurrent.mockRejectedValueOnce(Error('confirmation failed'));
      const turn = fixture.turns[1];
      update({
        status: 'idle',
        messages: turn.semantic.map((m, i) => ({
          ...m,
          delivery: {
            generation: i < 4 ? m.id : turn.generation,
            phase: 'complete',
            outcome: 'success',
          },
        })),
        toolCalls: [],
        interrupts: [],
        subgraphs: [],
        values: { analysis: turn.analysis },
      });
      run.resolve('success');
      await pending;
      await tick();
    },
    get run() {
      return run;
    },
    get load() {
      return load;
    },
  };
}
const mounts: { root: Root; container: HTMLDivElement }[] = [];
afterEach(async () => {
  for (const { root, container } of mounts.splice(0)) {
    await act(async () => {
      root.unmount();
      await tick();
    });
    container.remove();
  }
  observed.inputs.length = 0;
  observed.panels.length = 0;
  window.localStorage.clear();
});
async function mount() {
  const h = setup(),
    container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounts.push({ root, container });
  const ready = vi.fn();
  await act(async () =>
    root.render(<DebugDemo application={h.application} onReady={ready} />)
  );
  return Object.assign(h, { container, ready, root });
}
function button(container: HTMLElement, label: string) {
  const el = Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent === label
  );
  if (!el) throw Error(`Missing ${label}`);
  return el;
}
async function click(container: HTMLElement, label: string) {
  await act(async () => {
    button(container, label).click();
    await tick();
  });
}
async function draft(container: HTMLElement, text: string) {
  await act(async () => {
    const el = container.querySelector('textarea')!;
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function send(h: Awaited<ReturnType<typeof mount>>) {
  await draft(h.container, fixture.turns[0].input);
  await click(h.container, 'Send');
  await act(async () => h.stream());
}
it('initial render and New are lazy and ready is signalled', async () => {
  const h = await mount();
  expect(h.container.querySelector('h1')?.textContent).toBe('Chat debug');
  expect(h.ready).toHaveBeenCalledOnce();
  expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  await click(h.container, 'New conversation');
  expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
it('panel open/dock/tabs/close preserve draft and application snapshots without SDK effects', async () => {
  const h = await mount(),
    before = h.application.getSnapshot(),
    input = h.container.querySelector('textarea');
  await draft(h.container, 'Keep my draft');
  for (const label of [
    'Open debug panel',
    'Dock bottom',
    'Timeline',
    'State',
    'Hide debug panel',
  ]) {
    await click(h.container, label);
    expect(h.container.querySelector('textarea')).toBe(input);
    expect(input?.value).toBe('Keep my draft');
    expect(h.application.getSnapshot()).toBe(before);
    expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
  }
});
it('renders native H plus all three assistants and observed analysis after confirmation', async () => {
  const h = await mount();
  await send(h);
  expect(button(h.container, 'New conversation').disabled).toBe(false);
  await act(async () => h.finish());
  expect(h.container.textContent).toContain('Confirming saved response');
  await act(async () => h.saved());
  const articles = h.container.querySelectorAll(
    'article[aria-label="Assistant"]'
  );
  expect(articles).toHaveLength(3);
  for (const m of fixture.turns[0].semantic)
    expect(h.container.textContent).toContain(m.content);
  expect(
    h.container.querySelector('[aria-label="Observed analysis"]')?.textContent
  ).toContain('41 characters');
  expect(
    h.container.querySelector('[aria-label="Observed analysis"]')?.textContent
  ).toContain('7 words');
  expect(h.application.getSnapshot().canSubmit).toBe(true);
});
it.each(['running', 'confirming'] as const)(
  'panel changes during %s preserve input and do not read/stop/dispose',
  async (phase) => {
    const h = await mount();
    await send(h);
    if (phase === 'confirming') await act(async () => h.finish());
    await draft(h.container, 'Next draft');
    const before = h.effects(),
      snapshot = h.application.getSnapshot(),
      input = h.container.querySelector('textarea');
    for (const label of [
      'Open debug panel',
      'Timeline',
      'Dock bottom',
      'State',
      'Hide debug panel',
    ])
      await click(h.container, label);
    expect(h.effects()).toEqual(before);
    expect(h.application.getSnapshot()).toBe(snapshot);
    expect(input?.value).toBe('Next draft');
    expect(button(h.container, 'New conversation').disabled).toBe(false);
    h.run.resolve('success');
    h.load.resolve();
  }
);
it('New clears the draft synchronously and retained callbacks carry full stale owner keys', async () => {
  const h = await mount();
  await draft(h.container, 'Discard draft');
  const input = observed.inputs.at(-1)!,
    panel = observed.panels.at(-1)!;
  await click(h.container, 'New conversation');
  expect(h.container.querySelector('textarea')?.value).toBe('');
  await act(async () => {
    expect(input.onSubmit('old')).toBe(false);
    panel.onRefresh?.({ contextKey: panel.contextKey, pageGeneration: null });
    panel.onInspect?.({
      contextKey: panel.contextKey,
      pageGeneration: 0,
      rowKey: 'stale',
    });
    await tick();
  });
  expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0]);
});
it('application unmount owns cleanup; closing the passive panel does not', async () => {
  const h = await mount();
  await send(h);
  await click(h.container, 'Open debug panel');
  await click(h.container, 'Hide debug panel');
  expect(h.session.dispose).not.toHaveBeenCalled();
  await act(async () => {
    h.root.unmount();
    h.run.resolve('success');
    h.load.resolve();
    await tick();
  });
  expect(h.session.dispose).toHaveBeenCalledOnce();
});
it.each(['stop', 'new'] as const)(
  'New clears a draft typed during held %s cleanup and enables Send after settlement',
  async (first) => {
    const h = await mount();
    await send(h);
    await act(async () => h.finish());
    await act(async () => h.saved());
    const held = deferred<void>();
    h.session.dispose.mockReturnValueOnce(held.promise);
    let pending: Promise<void> | undefined;
    if (first === 'stop') {
      await act(async () => {
        pending = h.beginFollowup();
        await tick();
      });
      await click(h.container, 'Stop');
    } else await click(h.container, 'New conversation');
    await draft(h.container, 'Discard draft typed while closing');
    const old = h.application.getSnapshot().contextKey;
    await click(h.container, 'New conversation');
    expect.soft(h.container.querySelector('textarea')?.value).toBe('');
    expect.soft(h.application.getSnapshot().contextKey).not.toBe(old);
    expect.soft(h.container.querySelectorAll('article')).toHaveLength(0);
    expect(h.application.getSnapshot().canSubmit).toBe(false);
    await act(async () => {
      held.resolve();
      h.run.resolve('success');
      await pending;
      await tick();
    });
    await draft(h.container, 'Fresh question');
    expect(button(h.container, 'Send').disabled).toBe(false);
    expect(h.session.dispose).toHaveBeenCalledTimes(1);
  }
);
it.each(['refresh', 'inspect'] as const)(
  'shows last confirmed explanation alongside failed %s feedback after an unconfirmed follow-up',
  async (mode) => {
    const h = await mount();
    await send(h);
    await act(async () => h.finish());
    await act(async () => h.saved());
    await act(async () => h.failFollowup());
    const page = h.application.getSnapshot().checkpointPage!;
    if (mode === 'refresh')
      h.client.readHistory.mockRejectedValueOnce(Error('read failed'));
    else h.client.readCheckpoint.mockRejectedValueOnce(Error('read failed'));
    await act(async () => {
      if (mode === 'refresh')
        await h.application.refresh({
          contextKey: page.contextKey,
          pageGeneration: page.pageGeneration,
        });
      else
        await h.application.inspect({
          contextKey: page.contextKey,
          pageGeneration: page.pageGeneration,
          rowKey: page.rows[0].rowKey,
        });
      await tick();
    });
    expect(h.container.textContent).toContain(
      'Last confirmed conversation shown'
    );
    expect(h.container.textContent).toContain(
      mode === 'refresh'
        ? 'History refresh failed'
        : 'Checkpoint inspection failed'
    );
    expect(
      h.container.querySelectorAll('article[aria-label="Assistant"]')
    ).toHaveLength(3);
    expect(
      h.container.querySelector('[aria-label="Observed analysis"]')?.textContent
    ).toContain('41 characters');
    await draft(h.container, 'Blocked follow-up');
    expect(button(h.container, 'Send').disabled).toBe(true);
  }
);
