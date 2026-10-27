import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { CompleteOutcome, Message } from '@threadplane/core';
import type { ChatInputProps } from '@threadplane/react/chat';
import { createThemingApplication, type ThemingSession } from './application';
import { ThemingDemo } from './app';

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const observed = vi.hoisted(() => ({ inputs: [] as ChatInputProps[] }));
vi.mock('@threadplane/react/chat', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@threadplane/react/chat')
  >();
  return {
    ...actual,
    ChatInput(props: ChatInputProps) {
      observed.inputs.push(props);
      return <actual.ChatInput {...props} />;
    },
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
async function tick() {
  for (let i = 0; i < 24; i++) await Promise.resolve();
}
function setup() {
  const run = deferred<CompleteOutcome>(),
    load = deferred<void>();
  let state: ReturnType<ThemingSession['getSnapshot']> = {
    status: 'idle',
    messages: [],
    toolCalls: [],
    interrupts: [],
    subgraphs: [],
    history: undefined,
  };
  const observers = new Set<() => void>();
  const session: ThemingSession = {
    getSnapshot: () => state,
    subscribe: vi.fn((notify) => {
      observers.add(notify);
      return () => observers.delete(notify);
    }),
    submit: vi.fn(() => run.promise),
    load: vi.fn(() => load.promise),
    stop: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined),
  };
  const createThread = vi.fn(async () => 'thread'),
    sessionFactory = vi.fn(() => session);
  const application = createThemingApplication({
    createThread,
    sessionFactory,
  });
  const factory = vi.fn(() => application);
  const effects = () =>
    [
      createThread,
      sessionFactory,
      session.subscribe,
      session.submit,
      session.load,
      session.stop,
      session.dispose,
    ].map((fn) => vi.mocked(fn).mock.calls.length);
  const human: Message = {
    id: 'human',
    role: 'user',
    content: 'Why do aircraft bank?',
    delivery: { generation: 'turn', phase: 'complete', outcome: 'success' },
  };
  const answer: Message = {
    id: 'answer',
    role: 'assistant',
    content: 'Banking redirects **lift**.',
    reasoning: 'Lift direction changes.',
    delivery: { generation: 'turn', phase: 'complete', outcome: 'success' },
  };
  function update(patch: Partial<typeof state>) {
    state = { ...state, ...patch };
    for (const notify of observers) notify();
  }
  return {
    application,
    factory,
    session,
    run,
    load,
    effects,
    human,
    answer,
    update,
    async stream() {
      update({
        status: 'running',
        messages: [
          human,
          { ...answer, delivery: { generation: 'turn', phase: 'streaming' } },
        ],
      });
      await tick();
    },
    async confirm() {
      update({ status: 'idle', messages: [human, answer] });
      run.resolve('success');
      await tick();
    },
    async saved() {
      update({
        messages: [human, answer].map((message) => ({
          ...message,
          delivery: {
            generation: message.id,
            phase: 'complete',
            outcome: 'success',
          },
        })),
        history: [
          { next: [], checkpoint: { thread_id: 'thread', checkpoint_ns: '' } },
        ],
      });
      load.resolve();
      await tick();
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
});
async function mount(h = setup()) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  mounts.push({ root, container });
  const ready = vi.fn();
  await act(async () =>
    root.render(
      <ThemingDemo
        connection={{ apiUrl: 'https://unused.invalid', headers: {} }}
        applicationFactory={h.factory}
        onReady={ready}
      />
    )
  );
  return { ...h, container, ready };
}
function button(container: HTMLElement, name: string) {
  const result = Array.from(container.querySelectorAll('button')).find(
    (node) => node.textContent === name
  );
  expect(result, `${name} button`).toBeDefined();
  if (!result) throw new Error(`${name} button is missing`);
  return result;
}
function input(container: HTMLElement) {
  const result = container.querySelector('textarea');
  expect(result).not.toBeNull();
  if (!result) throw new Error('Message input is missing');
  return result;
}
function latestInput() {
  const result = observed.inputs.at(-1);
  if (!result) throw new Error('ChatInput did not render');
  return result;
}
async function click(container: HTMLElement, name: string) {
  await act(async () => {
    button(container, name).click();
    await tick();
  });
}
async function draft(container: HTMLElement, text: string) {
  await act(async () => {
    const node = input(container);
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )?.set;
    if (!setter) throw new Error('Textarea value setter is missing');
    setter.call(node, text);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
async function send(container: HTMLElement) {
  await draft(container, 'Why do aircraft bank?');
  await click(container, 'Send');
}

it('starts Dark, labels the demo and explains real chat tokens and aviation questions', async () => {
  const h = await mount();
  expect(h.container.querySelector('h1')?.textContent).toBe('Chat theming');
  expect(button(h.container, 'Dark').getAttribute('aria-pressed')).toBe('true');
  for (const name of ['Light', 'Ocean', 'Forest'])
    expect(button(h.container, name).getAttribute('aria-pressed')).toBe(
      'false'
    );
  for (const token of [
    'text',
    'muted',
    'border',
    'surface',
    'accent',
    'on-accent',
    'danger',
    'gap',
  ])
    expect(h.container.textContent).toContain(`--tp-chat-${token}`);
  expect(input(h.container).placeholder).toContain('aviation');
  expect(h.ready).toHaveBeenCalledTimes(1);
  expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0]);
});

it('preserves the exact application, mounted input, draft and generation for every palette', async () => {
  const h = await mount(),
    snapshot = h.application.getSnapshot(),
    node = input(h.container);
  await draft(h.container, '  Keep my aviation question  ');
  for (const name of ['Light', 'Ocean', 'Forest', 'Dark']) {
    await click(h.container, name);
    expect(button(h.container, name).getAttribute('aria-pressed')).toBe('true');
    expect(
      h.container
        .querySelector('.tp-chat.theming-demo')
        ?.getAttribute('data-theme')
    ).toBe(name.toLowerCase());
    expect(
      h.container.querySelector(
        `.tp-chat.theming-demo.theming-demo--${name.toLowerCase()}`
      )
    ).not.toBeNull();
    expect(input(h.container)).toBe(node);
    expect(node.value).toBe('  Keep my aviation question  ');
    expect(h.application.getSnapshot()).toBe(snapshot);
    expect(h.factory).toHaveBeenCalledTimes(1);
    expect(h.factory.mock.results[0].value).toBe(h.application);
    expect(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  }
});

it.each(['running', 'confirming'] as const)(
  'palette changes have no conversation effects during held %s',
  async (phase) => {
    const h = await mount();
    await send(h.container);
    await act(async () => h.stream());
    if (phase === 'confirming') await act(async () => h.confirm());
    expect(h.application.getSnapshot().activity).toBe(phase);
    await draft(h.container, 'Next aviation question');
    const before = h.application.getSnapshot(),
      effects = h.effects(),
      article = h.container.querySelector('article[aria-label="Assistant"]'),
      textarea = input(h.container);
    expect(article?.textContent).toContain('Banking redirects lift.');
    expect(
      article
        ?.querySelector('.tp-reasoning')
        ?.closest('.theming-demo__message-body')
    ).not.toBeNull();
    expect(
      article?.querySelector('.theming-demo__message-body p')
    ).not.toBeNull();
    for (const name of ['Ocean', 'Forest', 'Light', 'Dark']) {
      await click(h.container, name);
      expect(h.application.getSnapshot()).toBe(before);
      expect(h.application.getSnapshot().rows).toBe(before.rows);
      expect(h.effects()).toEqual(effects);
      expect(h.container.querySelector('article[aria-label="Assistant"]')).toBe(
        article
      );
      expect(input(h.container)).toBe(textarea);
      expect(textarea.value).toBe('Next aviation question');
    }
    if (phase === 'running') await act(async () => h.confirm());
    await act(async () => h.saved());
    expect(input(h.container).value).toBe('Next aviation question');
    expect(button(h.container, 'Send').disabled).toBe(false);
    expect(h.application.getSnapshot().canSubmit).toBe(true);
  }
);

it('two mounted roots switch independently without touching document or an outside sentinel', async () => {
  const beforeClass = document.documentElement.className,
    beforeStyle = document.documentElement.getAttribute('style');
  const sentinel = document.createElement('div');
  sentinel.style.setProperty('--tp-chat-text', 'purple');
  document.body.append(sentinel);
  try {
    const first = await mount(),
      second = await mount();
    await draft(second.container, 'Second draft');
    await click(first.container, 'Ocean');
    expect(button(second.container, 'Dark').getAttribute('aria-pressed')).toBe(
      'true'
    );
    await click(second.container, 'Forest');
    expect(button(first.container, 'Ocean').getAttribute('aria-pressed')).toBe(
      'true'
    );
    expect(input(second.container).value).toBe('Second draft');
    expect(first.factory).toHaveBeenCalledTimes(1);
    expect(second.factory).toHaveBeenCalledTimes(1);
    expect(document.documentElement.className).toBe(beforeClass);
    expect(document.documentElement.getAttribute('style')).toBe(beforeStyle);
    expect(sentinel.style.getPropertyValue('--tp-chat-text')).toBe('purple');
  } finally {
    sentinel.remove();
  }
});

it('cleanup failure disables New and Send, gives reload guidance and leaves palettes local', async () => {
  const h = await mount();
  await send(h.container);
  await act(async () => h.stream());
  vi.mocked(h.session.dispose).mockRejectedValueOnce(Error('cleanup failed'));
  await click(h.container, 'Stop');
  expect(h.application.getSnapshot().activity).toBe('cleanup-failed');
  expect(button(h.container, 'New conversation').disabled).toBe(true);
  expect(button(h.container, 'Send').disabled).toBe(true);
  expect(h.container.querySelector('[role="alert"]')?.textContent).toContain(
    'Reload'
  );
  const before = h.effects();
  await click(h.container, 'Ocean');
  expect(button(h.container, 'Ocean').getAttribute('aria-pressed')).toBe(
    'true'
  );
  expect(h.effects()).toEqual(before);
});

it('Stop revokes continuation and New replaces only through the actual owner generation', async () => {
  const h = await mount();
  await send(h.container);
  await act(async () => h.stream());
  const before = h.application.getSnapshot().viewGeneration;
  await click(h.container, 'Stop');
  expect(h.session.stop).toHaveBeenCalledTimes(1);
  expect(h.session.dispose).toHaveBeenCalledTimes(1);
  expect(h.application.getSnapshot().viewGeneration).toBe(before + 1);
  expect(button(h.container, 'Send').disabled).toBe(true);
  await click(h.container, 'New conversation');
  expect(h.application.getSnapshot().viewGeneration).toBe(before + 2);
  expect(h.application.getSnapshot().rows).toHaveLength(0);
  await draft(h.container, 'Fresh aviation question');
  expect(button(h.container, 'Send').disabled).toBe(false);
  expect(h.factory).toHaveBeenCalledTimes(1);
});

it('retained Send rejects a stale rendered generation even after New admits fresh input', async () => {
  const h = await mount();
  const retained = latestInput().onSubmit;
  await click(h.container, 'New conversation');
  expect(h.application.getSnapshot().canSubmit).toBe(true);
  let accepted: boolean | void = undefined;
  await act(async () => {
    accepted = retained('Stale question');
    await tick();
  });
  expect.soft(accepted).toBe(false);
  expect.soft(h.effects()).toEqual([0, 0, 0, 0, 0, 0, 0]);
  const fresh = latestInput().onSubmit,
    generation = h.application.getSnapshot().viewGeneration;
  const submit = vi.spyOn(h.application, 'submit');
  await act(async () => {
    expect(fresh('Fresh question')).toBe(true);
    await tick();
  });
  expect(submit).toHaveBeenCalledWith('Fresh question', generation);
  expect(h.session.submit).toHaveBeenCalledTimes(1);
});

it('retained Send rejects current-disabled dispatch without reporting acceptance or changing a valid draft', async () => {
  const h = await mount(),
    retained = latestInput().onSubmit;
  await send(h.container);
  await draft(h.container, 'Keep this draft');
  const before = h.effects();
  let accepted: boolean | void = undefined;
  await act(async () => {
    accepted = retained('Duplicate question');
    await tick();
  });
  expect(accepted).toBe(false);
  expect(h.effects()).toEqual(before);
  expect(input(h.container).value).toBe('Keep this draft');
});
