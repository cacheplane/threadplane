import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { createSession } from '@threadplane/langgraph';
import { App } from './app';
import {
  createReactApplication,
  type ReactApplicationSnapshot,
} from './application';
import { applicationFixture } from './application-fixture';
import { NativeComposer } from './native-composer';

afterEach(cleanup);

async function emptyApplication(held?: {
  response: Promise<void>;
  finish: Promise<void>;
}) {
  const fixture = applicationFixture();
  const commands: string[] = [];
  const application = createReactApplication({
    ...fixture.options,
    sessionFactory: (id) =>
      createSession({
        assistantId: 'assistant',
        threadId: id,
        transport: {
          async getHistory() {
            commands.push('history');
            return [];
          },
          async *stream() {
            commands.push('submit');
            if (held) {
              await held.response;
              yield {
                type: 'values',
                data: {
                  messages: [
                    {
                      type: 'ai',
                      id: 'response',
                      content: 'A helpful response',
                    },
                  ],
                },
              };
              await held.finish;
            }
          },
        },
      }),
  });
  application.start();
  await waitFor(() =>
    expect(application.getSnapshot().selection.status).toBe('ready')
  );
  return { application, commands };
}

it('prefills and focuses locally in the real application, and waits for explicit Send', async () => {
  const { application, commands } = await emptyApplication();
  try {
    const view = render(<App application={application} />);
    expect(
      view.getByRole('heading', { name: 'How can I help?', level: 2 })
    ).toBeTruthy();
    const input = view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    const before = [...commands];
    fireEvent.click(view.getByRole('button', { name: 'Plan a weekend trip' }));
    expect(input.value).toBe('Help me plan a weekend trip.');
    expect(document.activeElement).toBe(input);
    expect(commands).toEqual(before);
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    });
    // The real runtime refreshes accepted history after response completion.
    expect(commands).toEqual([...before, 'submit', 'history']);
    expect(input.value).toBe('');
    expect(view.getByRole('textbox', { name: 'Message' })).toBe(input);
  } finally {
    application.dispose();
  }
});

it('retains the actual App textarea and draft through first message and response publication', async () => {
  let respond!: () => void;
  let finish!: () => void;
  const response = new Promise<void>((resolve) => {
    respond = resolve;
  });
  const completion = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const { application } = await emptyApplication({
    response,
    finish: completion,
  });
  try {
    const view = render(<App application={application} />);
    const input = inputOf(view);
    fireEvent.change(input, { target: { value: 'A draft to keep' } });
    // A separately admitted application command publishes the first message;
    // this draft has not been sent and must survive the resulting view updates.
    act(() => {
      expect(application.submit('Independent request')).toBe(true);
    });
    await waitFor(() =>
      expect(application.getSnapshot().submission.active).toBe(true)
    );
    expect(view.queryByRole('heading', { name: 'How can I help?' })).toBeNull();
    expect(inputOf(view)).toBe(input);
    expect(input.value).toBe('A draft to keep');
    await act(async () => {
      respond();
    });
    expect(await view.findByText('A helpful response')).toBeTruthy();
    expect(inputOf(view)).toBe(input);
    expect(input.value).toBe('A draft to keep');
    await act(async () => {
      finish();
    });
    await waitFor(() =>
      expect(application.getSnapshot().submission.active).toBe(false)
    );
    expect(inputOf(view)).toBe(input);
    expect(input.value).toBe('A draft to keep');
  } finally {
    respond();
    finish();
    application.dispose();
  }
});

const disposals: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposals.splice(0)) dispose();
});

async function owner() {
  const f = await emptyApplication();
  disposals.push(f.application.dispose);
  let snapshot = f.application.getSnapshot();
  let admitted = true;
  const submit = vi.fn(() => true);
  const application = {
    ...f.application,
    getSnapshot: vi.fn(() => snapshot),
    canSubmit: vi.fn(() => admitted),
    submit,
    stop: vi.fn(),
    select: vi.fn(),
    create: vi.fn(),
    refresh: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    application,
    submit,
    snapshot: () => snapshot,
    set(next: ReactApplicationSnapshot) {
      snapshot = next;
    },
    admit(next: boolean) {
      admitted = next;
    },
    commands: f.commands,
  };
}

const suggestion = 'Plan a weekend trip';
const prompt = 'Help me plan a weekend trip.';
function retainedClick(button: HTMLElement) {
  const key = Object.keys(button).find((key) =>
    key.startsWith('__reactProps$')
  )!;
  const click = (
    button as unknown as Record<
      string,
      { onClick: (event: { defaultPrevented: boolean }) => void }
    >
  )[key].onClick;
  return () => click({ defaultPrevented: false });
}
function inputOf(view: ReturnType<typeof render>) {
  return view.getByRole('textbox', { name: 'Message' }) as HTMLTextAreaElement;
}

it.each(['A draft', '   '])(
  'protects the nonempty draft %j and reenables suggestions after clear',
  async (draft) => {
    const f = await owner();
    const view = render(
      <NativeComposer application={f.application} snapshot={f.snapshot()} />
    );
    const input = inputOf(view);
    const oldClick = retainedClick(
      view.getByRole('button', { name: suggestion })
    );
    fireEvent.change(input, { target: { value: draft } });
    expect(
      (view.getByRole('button', { name: suggestion }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    act(oldClick);
    expect(input.value).toBe(draft);
    fireEvent.change(input, { target: { value: '' } });
    expect(
      (view.getByRole('button', { name: suggestion }) as HTMLButtonElement)
        .disabled
    ).toBe(false);
    fireEvent.click(view.getByRole('button', { name: suggestion }));
    expect(input.value).toBe(prompt);
    expect(f.submit).not.toHaveBeenCalled();
  }
);

it('guards the draft synchronously before React commits the controlled change', async () => {
  const f = await owner();
  const view = render(
    <NativeComposer application={f.application} snapshot={f.snapshot()} />
  );
  const input = inputOf(view);
  const oldClick = retainedClick(
    view.getByRole('button', { name: suggestion })
  );
  const key = Object.keys(input).find((key) =>
    key.startsWith('__reactProps$')
  )!;
  const change = (
    input as unknown as Record<
      string,
      { onChange: (event: { target: { value: string } }) => void }
    >
  )[key].onChange;
  act(() => {
    change({ target: { value: 'just typed' } });
    oldClick();
  });
  expect(input.value).toBe('just typed');
});

it('prefills both literal suggestions without issuing any owner commands', async () => {
  const f = await owner();
  const view = render(
    <NativeComposer application={f.application} snapshot={f.snapshot()} />
  );
  expect(view.getByText(/Review it before pressing Send/)).toBeTruthy();
  for (const [label, value] of [
    [suggestion, prompt],
    ['Explain a topic', 'Help me understand a topic step by step.'],
  ]) {
    fireEvent.click(view.getByRole('button', { name: label }));
    expect(inputOf(view).value).toBe(value);
    expect(document.activeElement).toBe(inputOf(view));
    fireEvent.change(inputOf(view), { target: { value: '' } });
  }
  for (const command of [
    f.submit,
    f.application.stop,
    f.application.select,
    f.application.create,
    f.application.refresh,
    f.application.dispose,
  ])
    expect(command).not.toHaveBeenCalled();
  expect(f.commands).toEqual(['history']);
});

it('rejects a live replacement thread and revalidates after capability reads', async () => {
  const f = await owner();
  const ready = f.snapshot();
  const view = render(
    <NativeComposer application={f.application} snapshot={ready} />
  );
  const click = retainedClick(view.getByRole('button', { name: suggestion }));
  f.set({ ...ready, selection: { ...ready.selection, id: 'b' } });
  act(click);
  expect(inputOf(view).value).toBe('');
  f.set(ready);
  f.application.canSubmit.mockImplementationOnce(() => {
    f.set(ineligible(ready, 'unconfirmed deletion'));
    return true;
  });
  act(click);
  expect(inputOf(view).value).toBe('');
});

it.each([false, true])(
  'retains refused drafts and clears accepted drafts (accepted=%s)',
  async (accepted) => {
    const f = await owner();
    f.submit.mockReturnValue(accepted);
    const view = render(
      <NativeComposer application={f.application} snapshot={f.snapshot()} />
    );
    fireEvent.click(view.getByRole('button', { name: suggestion }));
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
    expect(f.submit.mock.calls).toEqual([[prompt]]);
    expect(inputOf(view).value).toBe(accepted ? '' : prompt);
  }
);

function ineligible(
  snapshot: ReactApplicationSnapshot,
  mode: string
): ReactApplicationSnapshot {
  if (mode === 'unavailable') return { ...snapshot, runtime: null };
  if (mode === 'active')
    return { ...snapshot, submission: { active: true, outcome: null } };
  if (mode === 'pending deletion' || mode === 'unconfirmed deletion')
    return {
      ...snapshot,
      deletion: {
        ...snapshot.deletion,
        id: snapshot.selection.id,
        status: mode === 'pending deletion' ? 'pending' : 'unconfirmed',
      },
    } as ReactApplicationSnapshot;
  if (['empty', 'pending', 'missing', 'error selection'].includes(mode))
    return {
      ...snapshot,
      selection: {
        ...snapshot.selection,
        status: mode === 'error selection' ? 'error' : mode,
      },
    } as ReactApplicationSnapshot;
  if (mode === 'messages')
    return { ...snapshot, messages: [{}] } as ReactApplicationSnapshot;
  return {
    ...snapshot,
    runtime: {
      ...snapshot.runtime!,
      ...(mode === 'running'
        ? { status: 'running' }
        : mode === 'error'
        ? { error: { kind: 'server', message: 'failed', retryable: false } }
        : { reconnect: { runId: 'run' } }),
    },
  } as ReactApplicationSnapshot;
}

it.each([
  'unavailable',
  'active',
  'pending deletion',
  'unconfirmed deletion',
  'empty',
  'pending',
  'missing',
  'error selection',
  'messages',
  'running',
  'error',
  'reconnect',
  'cannot submit',
])(
  'hides welcome for %s and rejects live changes before a rerender',
  async (mode) => {
    const f = await owner();
    const ready = f.snapshot();
    const view = render(
      <NativeComposer application={f.application} snapshot={ready} />
    );
    const click = retainedClick(view.getByRole('button', { name: suggestion }));
    if (mode === 'cannot submit') f.admit(false);
    else f.set(ineligible(ready, mode));
    act(click);
    expect(inputOf(view).value).toBe('');
    view.rerender(
      <NativeComposer application={f.application} snapshot={f.snapshot()} />
    );
    expect(view.queryByRole('heading', { name: 'How can I help?' })).toBeNull();
    expect(view.queryByRole('button', { name: suggestion })).toBeNull();
    expect(f.submit).not.toHaveBeenCalled();
  }
);

it.each(['application', 'thread', 'eligibility'])(
  'expires old %s occurrences through A-B-A and unmount',
  async (mode) => {
    const f = await owner();
    const g = await owner();
    const ready = f.snapshot();
    const content = (application = f.application, snapshot = f.snapshot()) => (
      <StrictMode>
        <NativeComposer application={application} snapshot={snapshot} />
      </StrictMode>
    );
    const view = render(content());
    const click = retainedClick(view.getByRole('button', { name: suggestion }));
    if (mode === 'application')
      view.rerender(content(g.application, g.snapshot()));
    else {
      f.set(
        mode === 'thread'
          ? { ...ready, selection: { ...ready.selection, id: 'b' } }
          : ineligible(ready, 'running')
      );
      view.rerender(content());
    }
    f.set(ready);
    view.rerender(content());
    act(click);
    expect(inputOf(view).value).toBe('');
    const current = retainedClick(
      view.getByRole('button', { name: suggestion })
    );
    view.rerender(content());
    act(current);
    expect(inputOf(view).value).toBe(prompt);
    fireEvent.change(inputOf(view), { target: { value: '' } });
    const retired = retainedClick(
      view.getByRole('button', { name: suggestion })
    );
    view.unmount();
    const reads = f.application.getSnapshot.mock.calls.length;
    act(retired);
    expect(f.application.getSnapshot.mock.calls).toHaveLength(reads);
  }
);

it('keeps the textarea, draft and passive focus across welcome, first messages, response and retained renders', async () => {
  const f = await owner();
  const ready = f.snapshot();
  const content = () => (
    <>
      <button type="button">Outside</button>
      <NativeComposer application={f.application} snapshot={f.snapshot()} />
    </>
  );
  const view = render(content());
  const input = inputOf(view);
  fireEvent.change(input, { target: { value: 'Keep my draft' } });
  view.getByRole('button', { name: 'Outside' }).focus();
  for (const mode of [
    'messages',
    'running',
    'error',
    'reconnect',
    'messages',
    'ready',
    'ready',
  ]) {
    f.set(mode === 'ready' ? ready : ineligible(ready, mode));
    view.rerender(content());
    expect(inputOf(view)).toBe(input);
    expect(input.value).toBe('Keep my draft');
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'Outside' })
    );
  }
  expect(f.application.stop).not.toHaveBeenCalled();
  expect(f.application.select).not.toHaveBeenCalled();
  expect(f.application.create).not.toHaveBeenCalled();
  expect(f.application.refresh).not.toHaveBeenCalled();
  expect(f.application.dispose).not.toHaveBeenCalled();
  expect(f.commands).toEqual(['history']);
});

async function followupOwner() {
  const fixture = applicationFixture();
  const actual = createReactApplication({
    ...fixture.options,
    sessionFactory: (id) =>
      createSession({
        assistantId: 'assistant',
        threadId: id,
        transport: {
          async getHistory() {
            return [
              {
                checkpoint: {
                  thread_id: id,
                  checkpoint_ns: '',
                  checkpoint_id: 'saved',
                  checkpoint_map: {},
                },
                parent_checkpoint: null,
                created_at: '2026-09-28T00:00:00.000Z',
                next: [],
                tasks: [],
                metadata: null,
                values: {
                  messages: [{ type: 'ai', id: 'answer', content: 'Answer' }],
                },
              },
            ];
          },
          async *stream() {
            yield {
              type: 'values',
              data: {
                messages: [{ type: 'ai', id: 'answer', content: 'Answer' }],
              },
            };
          },
        },
      }),
  });
  disposals.push(actual.dispose);
  actual.start();
  await waitFor(() =>
    expect(actual.getSnapshot().selection.status).toBe('ready')
  );
  const restored = actual.getSnapshot();
  act(() => {
    expect(actual.submit('Initial request')).toBe(true);
  });
  await waitFor(() =>
    expect(actual.getSnapshot().submission.outcome).toBe('success')
  );
  const completed = actual.getSnapshot();
  expect(
    completed.runtime?.messages.some((message) => message.role === 'assistant')
  ).toBe(true);
  expect(
    completed.messages.some((row) => row.message.role === 'assistant')
  ).toBe(true);
  let snapshot = completed;
  const application = {
    ...actual,
    getSnapshot: vi.fn(() => snapshot),
    canSubmit: vi.fn(() => actual.canSubmit()),
    submit: vi.fn((text: string) => actual.submit(text)),
  };
  return {
    application,
    completed,
    restored,
    set(next: ReactApplicationSnapshot) {
      snapshot = next;
    },
    snapshot: () => snapshot,
  };
}

it('admits app-authored follow-ups only after real text success and keeps selection local until Send', async () => {
  const f = await followupOwner();
  const view = render(
    <NativeComposer application={f.application} snapshot={f.restored} />
  );
  const input = inputOf(view);
  expect(view.queryByRole('button', { name: 'Make it shorter' })).toBeNull();
  view.rerender(
    <NativeComposer application={f.application} snapshot={f.completed} />
  );
  expect(inputOf(view)).toBe(input);
  expect(view.queryByRole('heading', { name: 'How can I help?' })).toBeNull();
  for (const [label, value] of [
    ['Make it shorter', 'Make that more concise.'],
    ['Give an example', 'Give me a concrete example.'],
  ]) {
    fireEvent.click(view.getByRole('button', { name: label }));
    expect(input.value).toBe(value);
    expect(document.activeElement).toBe(input);
    expect(f.application.submit).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: '' } });
  }
  fireEvent.click(view.getByRole('button', { name: 'Make it shorter' }));
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Send', exact: true }));
  });
  expect(f.application.submit.mock.calls).toEqual([
    ['Make that more concise.'],
  ]);
});

it.each([
  'restored',
  'decision',
  'active',
  'running',
  'paused',
  'error',
  'aborted',
  'interrupted',
  'missing runtime assistant',
  'missing projected assistant',
  'pending deletion',
  'unconfirmed deletion',
  'reconnect',
])(
  'excludes follow-ups for %s and rejects retained live controls',
  async (mode) => {
    const f = await followupOwner();
    const ready = f.completed;
    const view = render(
      <NativeComposer application={f.application} snapshot={ready} />
    );
    const click = retainedClick(
      view.getByRole('button', { name: 'Make it shorter' })
    );
    let next = ready;
    if (mode === 'restored') next = f.restored;
    else if (mode === 'decision')
      next = { ...ready, submissionKind: 'decision' };
    else if (['paused', 'error', 'aborted', 'interrupted'].includes(mode))
      next = {
        ...ready,
        submission: {
          active: false,
          outcome: mode as ReactApplicationSnapshot['submission']['outcome'],
        },
      };
    else if (mode === 'missing runtime assistant')
      next = { ...ready, runtime: { ...ready.runtime!, messages: [] } };
    else if (mode === 'missing projected assistant')
      next = { ...ready, messages: [] };
    else next = ineligible(ready, mode);
    f.set(next);
    act(click);
    expect(inputOf(view).value).toBe('');
    view.rerender(
      <NativeComposer application={f.application} snapshot={next} />
    );
    expect(view.queryByRole('button', { name: 'Make it shorter' })).toBeNull();
    expect(f.application.submit).not.toHaveBeenCalled();
  }
);

it.each(['before capability', 'during capability'])(
  'rejects a different successful submission occurrence %s without a render',
  async (boundary) => {
    const f = await followupOwner();
    const view = render(
      <NativeComposer application={f.application} snapshot={f.completed} />
    );
    const click = retainedClick(
      view.getByRole('button', { name: 'Make it shorter' })
    );
    const replace = () =>
      f.set({ ...f.completed, submission: { ...f.completed.submission } });
    if (boundary === 'before capability') replace();
    else
      f.application.canSubmit.mockImplementationOnce(() => {
        replace();
        return true;
      });
    act(click);
    expect(inputOf(view).value).toBe('');
    expect(f.application.submit).not.toHaveBeenCalled();
  }
);

it.each(['application', 'thread', 'eligibility', 'submission'])(
  'expires completed %s occurrences through A-B-A',
  async (mode) => {
    const f = await followupOwner();
    const g = await followupOwner();
    const content = (application = f.application, snapshot = f.snapshot()) => (
      <StrictMode>
        <NativeComposer application={application} snapshot={snapshot} />
      </StrictMode>
    );
    const view = render(content());
    const input = inputOf(view);
    const click = retainedClick(
      view.getByRole('button', { name: 'Make it shorter' })
    );
    if (mode === 'application')
      view.rerender(content(g.application, g.snapshot()));
    else {
      f.set(
        mode === 'thread'
          ? { ...f.completed, selection: { ...f.completed.selection, id: 'b' } }
          : mode === 'submission'
          ? { ...f.completed, submission: { ...f.completed.submission } }
          : ineligible(f.completed, 'active')
      );
      view.rerender(content());
    }
    f.set(f.completed);
    view.rerender(content());
    act(click);
    expect(input.value).toBe('');
    const current = retainedClick(
      view.getByRole('button', { name: 'Make it shorter' })
    );
    const competing = retainedClick(
      view.getByRole('button', { name: 'Give an example' })
    );
    act(() => {
      current();
      competing();
    });
    expect(inputOf(view)).toBe(input);
    expect(input.value).toBe('Make that more concise.');
    expect(f.application.submit).not.toHaveBeenCalled();
  }
);

it.each(['   ', 'Keep my draft'])(
  'protects follow-up draft %j and claimed events',
  async (draft) => {
    const f = await followupOwner();
    const view = render(
      <div onClickCapture={(event) => event.preventDefault()}>
        <NativeComposer application={f.application} snapshot={f.completed} />
      </div>
    );
    const input = inputOf(view);
    const button = view.getByRole('button', {
      name: 'Make it shorter',
    }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(input.value).toBe('');
    const click = retainedClick(button);
    fireEvent.change(input, { target: { value: draft } });
    expect(button.disabled).toBe(true);
    act(click);
    expect(input.value).toBe(draft);
    view.rerender(
      <div onClickCapture={(event) => event.preventDefault()}>
        <NativeComposer
          application={f.application}
          snapshot={ineligible(f.completed, 'running')}
        />
      </div>
    );
    expect(inputOf(view).value).toBe(draft);
    expect(inputOf(view)).toBe(input);
  }
);
