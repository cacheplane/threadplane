import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type {
  DirectoryResult,
  ThreadRow,
  RemovalInspection,
} from '../../shared/contracts';
import { applicationFixture } from './application-fixture';
import { createReactApplication } from './application';
import { App } from './app';
const dialogRequests = vi.hoisted(
  () => [] as { onConfirm: () => void; onCancel: () => void }[]
);
vi.mock('@threadplane/react/chat', async (original) => {
  const actual = await original<typeof import('@threadplane/react/chat')>();
  return {
    ...actual,
    ConfirmDialog: (
      props: import('@threadplane/react/chat').ConfirmDialogProps
    ) => {
      if (props.open) dialogRequests.push(props);
      return <actual.ConfirmDialog {...props} />;
    },
  };
});

beforeEach(() => {
  dialogRequests.length = 0;
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
    {},
  ] as unknown as DOMRectList);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
async function setup(paired = true, runEvidence?: 'running' | 'reconnect') {
  const fixture = applicationFixture();
  const rows: ThreadRow[] = [
    { id: 'a', title: 'Alpha' },
    { id: 'b/opaque', title: 'Beta', pinned: true },
    { id: 'c', title: 'Gamma', archived: true },
  ];
  let settle!: (value: DirectoryResult<Readonly<{ id: string }>>) => void;
  const remove = vi.fn(
    (_id: string, _signal: AbortSignal) =>
      new Promise<DirectoryResult<Readonly<{ id: string }>>>((resolve) => {
        settle = resolve;
      })
  );
  const inspectRemoval = vi.fn(
    async (id: string, _signal: AbortSignal): Promise<RemovalInspection> => ({
      kind: 'ready',
      value: rows.find((row) => row.id === id)!,
    })
  );
  const application = createReactApplication({
    ...fixture.options,
    sessionFactory: (id) => {
      const session = fixture.options.sessionFactory(id);
      return {
        ...session,
        getSnapshot: () => ({
          ...session.getSnapshot(),
          ...(runEvidence === 'running' ? { status: 'running' as const } : {}),
          ...(runEvidence === 'reconnect'
            ? { reconnect: { runId: 'retained-remote-run' } }
            : {}),
        }),
      };
    },
    directory: {
      ...fixture.options.directory,
      list: async () => ({ kind: 'ready', value: rows }),
      get: async (id) => ({
        kind: 'ready',
        value: rows.find((row) => row.id === id)!,
      }),
      rename: async (id, title) => ({ kind: 'ready', value: { id, title } }),
      setPinned: async (id, pinned) => ({
        kind: 'ready',
        value: { id, title: 'Ignored', pinned },
      }),
      setArchived: async (id, archived) => ({
        kind: 'ready',
        value: { id, title: 'Ignored', archived },
      }),
      setPinnedOrder: async (id, rank) => ({
        kind: 'ready',
        value: { id, title: 'Ignored', rank },
      }),
      remove,
      ...(paired ? { inspectRemoval } : {}),
    },
  });
  await act(async () => application.start());
  const view = render(<App application={application} />);
  const open = (name = 'Beta (b/opaque)') =>
    fireEvent.click(view.getByRole('button', { name: `Actions for ${name}` }));
  const request = (name?: string) => {
    open(name);
    fireEvent.click(
      view.getByRole('menuitem', { name: /^Delete conversation/ })
    );
  };
  const confirm = () =>
    fireEvent.click(view.getByRole('button', { name: 'Delete', exact: true }));
  const finish = async (confirmed = true, id = 'b/opaque') =>
    act(async () =>
      settle(confirmed ? { kind: 'ready', value: { id } } : { kind: 'failed' })
    );
  return {
    fixture,
    application,
    view,
    remove,
    inspectRemoval,
    open,
    request,
    confirm,
    finish,
  };
}
it('captures a literal immutable target, defaults to Cancel, and dispatches only after confirmation closes', async () => {
  const f = await setup();
  try {
    f.request();
    const dialog = f.view.getByRole('alertdialog', {
      name: 'Delete conversation?',
    });
    expect(dialog.textContent).toContain('Beta (b/opaque)');
    expect(dialog.textContent).toMatch(/permanent/i);
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Cancel' })
    );
    expect(f.remove).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(f.view.queryByRole('alertdialog')).toBeNull();
    expect(f.remove).not.toHaveBeenCalled();
    const remote = f.remove.getMockImplementation()!;
    f.remove.mockImplementationOnce((id, signal) => {
      expect(f.view.queryByRole('alertdialog')).toBeNull();
      return remote(id, signal);
    });
    f.request();
    f.confirm();
    expect(f.view.queryByRole('alertdialog')).toBeNull();
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.remove.mock.calls[0][0]).toBe('b/opaque');
    await f.finish();
  } finally {
    f.application.dispose();
  }
});
it('keeps Archive last, offers archived Delete, and hides Delete without the capability pair', async () => {
  const f = await setup();
  try {
    f.open();
    expect(f.view.getAllByRole('menuitem').at(-1)?.textContent).toMatch(
      /^Archive conversation/
    );
    fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
    await act(async () => {
      fireEvent.click(
        f.view.getByText('Archived conversations', { selector: 'summary' })
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    f.open('Gamma (c)');
    expect(
      f.view.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual([
      'Copy conversation ID for Gamma (c)',
      'Unarchive conversation for Gamma (c)',
      'Delete conversation for Gamma (c)',
    ]);
  } finally {
    f.application.dispose();
    f.view.unmount();
  }
  const unpaired = await setup(false);
  try {
    unpaired.open();
    expect(
      unpaired.view.queryByRole('menuitem', { name: /^Delete conversation/ })
    ).toBeNull();
  } finally {
    unpaired.application.dispose();
  }
});
it('preserves selected DOM and draft while pending, gates matching actions, and keeps other metadata usable', async () => {
  const f = await setup();
  try {
    const input = f.view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    const transcript = f.view.getByRole('region', {
      name: 'Conversation messages',
    });
    fireEvent.change(input, { target: { value: 'Keep draft' } });
    f.request();
    f.confirm();
    expect(f.view.getByRole('button', { name: 'Beta' })).toBeTruthy();
    f.open();
    for (const name of [
      /^Delete conversation/,
      /^Rename conversation/,
      /^Unpin conversation/,
      /^Archive conversation/,
    ])
      expect(
        (f.view.getByRole('menuitem', { name }) as HTMLButtonElement).disabled
      ).toBe(true);
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Copy conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
    f.open('Alpha (a)');
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Rename conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
    expect(
      (
        f.view.getByRole('menuitem', {
          name: /^Delete conversation/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
    input.focus();
    await f.finish();
    expect(f.view.getByRole('textbox', { name: 'Message' })).toBe(input);
    expect(input.value).toBe('Keep draft');
    expect(document.activeElement).toBe(input);
    expect(f.view.getByRole('region', { name: 'Conversation messages' })).toBe(
      transcript
    );
    expect(
      f.view.queryByRole('button', { name: 'Beta', exact: true })
    ).toBeNull();
  } finally {
    f.application.dispose();
  }
});
it('renders shared pending and explicit uncertain recovery across filtering and remount without replaying success', async () => {
  const f = await setup();
  try {
    f.request();
    f.confirm();
    fireEvent.change(f.view.getByRole('searchbox'), {
      target: { value: 'Alpha' },
    });
    expect(f.view.getByText(/Deleting conversation Beta/)).toBeTruthy();
    f.view.unmount();
    const replacement = render(<App application={f.application} />);
    expect(replacement.getByText(/Deleting conversation Beta/)).toBeTruthy();
    await f.finish(false);
    expect(replacement.getByText(/deletion.*unconfirmed/i)).toBeTruthy();
    expect(f.inspectRemoval).not.toHaveBeenCalled();
    await act(async () =>
      fireEvent.click(
        replacement.getByRole('button', { name: /^Check deletion status/ })
      )
    );
    expect(f.inspectRemoval).toHaveBeenCalledTimes(1);
    expect(
      replacement.queryByRole('button', { name: /^Check deletion status/ })
    ).toBeNull();
    replacement.unmount();
    const latest = render(<App application={f.application} />);
    expect(latest.queryByText(/Conversation deleted/)).toBeNull();
  } finally {
    f.application.dispose();
  }
});
it('blocks the selected draft pending and uncertain, then restores the same draft on positive inspection', async () => {
  const f = await setup();
  try {
    const input = f.view.getByRole('textbox', {
      name: 'Message',
    }) as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Selected draft' } });
    f.request('Alpha (a)');
    expect(f.view.getByRole('alertdialog').textContent).toMatch(/draft/i);
    fireEvent.click(
      f.view.getByRole('button', { name: 'Cancel', exact: true })
    );
    expect(input.value).toBe('Selected draft');
    f.request('Alpha (a)');
    f.confirm();
    expect(input.disabled).toBe(true);
    await f.finish(false, 'a');
    expect(input.disabled).toBe(true);
    await act(async () =>
      fireEvent.click(
        f.view.getByRole('button', { name: /^Check deletion status/ })
      )
    );
    expect(input.disabled).toBe(false);
    expect(input.value).toBe('Selected draft');
    f.request('Alpha (a)');
    f.confirm();
    await f.finish(true, 'a');
    expect(f.application.getSnapshot().selection.status).toBe('empty');
    expect(
      f.view.queryByRole('region', { name: 'Conversation messages' })
    ).toBeNull();
  } finally {
    f.application.dispose();
  }
});

it('rejects stale A/B/A confirmation callbacks and repeated confirmation without affecting the replacement request', async () => {
  const f = await setup();
  try {
    f.request('Alpha (a)');
    const oldA = dialogRequests.at(-1)!;
    fireEvent.click(
      f.view.getByRole('button', { name: 'Cancel', exact: true })
    );
    f.request();
    const oldB = dialogRequests.at(-1)!;
    fireEvent.click(
      f.view.getByRole('button', { name: 'Cancel', exact: true })
    );
    f.request('Alpha (a)');
    const current = dialogRequests.at(-1)!;
    act(() => {
      oldA.onConfirm();
      oldA.onCancel();
      oldB.onConfirm();
      oldB.onCancel();
    });
    expect(f.view.getByRole('alertdialog').textContent).toContain('Alpha (a)');
    expect(f.remove).not.toHaveBeenCalled();
    act(() => {
      current.onConfirm();
      current.onConfirm();
      current.onCancel();
    });
    expect(f.remove).toHaveBeenCalledTimes(1);
    expect(f.remove.mock.calls[0][0]).toBe('a');
    await f.finish(true, 'a');
  } finally {
    f.application.dispose();
  }
});
it('Escape and backdrop dismiss intent without deletion and a confirmed retired invoker uses the directory fallback', async () => {
  const f = await setup();
  try {
    f.request();
    fireEvent.keyDown(f.view.getByRole('alertdialog'), { key: 'Escape' });
    expect(f.view.queryByRole('alertdialog')).toBeNull();
    f.request();
    fireEvent.click(f.view.getByRole('alertdialog'), {
      clientX: -10,
      clientY: -10,
    });
    expect(f.view.queryByRole('alertdialog')).toBeNull();
    expect(f.remove).not.toHaveBeenCalled();
    f.request();
    f.confirm();
    await f.finish();
    expect(document.activeElement).toBe(f.view.getByRole('searchbox'));
  } finally {
    f.application.dispose();
  }
});

for (const evidence of ['running', 'reconnect'] as const) {
  it(`keeps selected ${evidence} Delete visible and disabled with an accessible reason`, async () => {
    const f = await setup(true, evidence);
    try {
      expect(
        f.view.queryByText(
          'Resolve the current run before deleting this conversation.'
        )
      ).toBeNull();
      f.open('Alpha (a)');
      const command = f.view.getByRole('menuitem', {
        name: /^Delete conversation for Alpha.*Resolve the current run/,
      }) as HTMLButtonElement;
      expect(command.disabled).toBe(true);
      expect(command.textContent).toContain(
        'Resolve the current run before deleting this conversation.'
      );
      expect(command.hidden).toBe(false);
      expect(command.closest('[hidden]')).toBeNull();
      fireEvent.click(command);
      expect(f.view.queryByRole('alertdialog')).toBeNull();
      expect(f.remove).not.toHaveBeenCalled();
      fireEvent.keyDown(f.view.getByRole('menu'), { key: 'Escape' });
      f.open();
      expect(
        (
          f.view.getByRole('menuitem', {
            name: /^Delete conversation for Beta/,
          }) as HTMLButtonElement
        ).disabled
      ).toBe(false);
    } finally {
      f.application.dispose();
    }
  });
}

it('announces an explicitly checked retirement only in its mounted request owner', async () => {
  const f = await setup();
  try {
    let inspect!: (value: RemovalInspection) => void;
    f.inspectRemoval.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          inspect = resolve;
        })
    );
    f.request();
    f.confirm();
    await f.finish(false);
    fireEvent.click(
      f.view.getByRole('button', { name: /^Check deletion status/ })
    );
    expect(f.view.getByText(/Checking deletion status for Beta/)).toBeTruthy();
    expect(
      (
        f.view.getByRole('button', {
          name: /Checking deletion status/,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
    await act(async () => inspect({ kind: 'missing', id: 'b/opaque' }));
    expect(f.view.getByText(/Conversation deleted: Beta/)).toBeTruthy();
    f.view.unmount();
    const replacement = render(<App application={f.application} />);
    expect(replacement.queryByText(/Conversation deleted/)).toBeNull();
  } finally {
    f.application.dispose();
  }
});
it('releases pending deletion focus observers when its directory unmounts', async () => {
  const f = await setup();
  try {
    const added = vi.spyOn(document, 'addEventListener');
    const removed = vi.spyOn(document, 'removeEventListener');
    f.request();
    f.confirm();
    const focusListeners = added.mock.calls
      .filter(([type]) => type === 'focusin')
      .map(([, listener]) => listener);
    f.view.unmount();
    for (const listener of focusListeners)
      expect(
        removed.mock.calls.some(
          ([type, value]) => type === 'focusin' && value === listener
        )
      ).toBe(true);
    await f.finish();
  } finally {
    f.application.dispose();
  }
});
