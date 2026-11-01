import {
  act,
  cleanup,
  fireEvent,
  render,
  within,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { NativeProjects } from './native-projects';
import { PROJECT_CATALOG_KEY as key } from './project-catalog';

beforeEach(() => {
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
  localStorage.clear();
});
function deferred() {
  let resolve!: (value: boolean) => void;
  const promise = new Promise<boolean>((done) => (resolve = done));
  return { promise, resolve };
}
const rows = [{ id: 'a', title: 'Alpha', projectId: ' p/x ' }];
function setupLastProject() {
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, projects: [{ id: 'last', name: 'Last' }] })
  );
  const held = deferred();
  const deletion = {
    canDeleteProject: () => true,
    deleteProject: vi.fn(() => held.promise),
  };
  function Host() {
    const [projectId, setProjectId] = useState<string | null>('last');
    return (
      <>
        <input aria-label="Draft" />
        <NativeProjects
          rows={[]}
          projectId={projectId}
          onSelect={setProjectId}
          deletion={deletion}
        />
      </>
    );
  }
  const view = render(<Host />);
  const confirmDeletion = () => {
    const trigger = view.getByRole('button', {
      name: 'More actions for project Last (last)',
      exact: true,
    });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
    const confirm = within(view.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete project',
      exact: true,
    });
    confirm.focus();
    fireEvent.click(confirm);
  };
  return { view, held, deletion, confirmDeletion };
}

it.each(['pending', 'immediate'] as const)(
  'focuses New project after the last project disappears on %s completion',
  async (timing) => {
    const { view, held, deletion, confirmDeletion } = setupLastProject();
    if (timing === 'immediate')
      deletion.deleteProject.mockResolvedValueOnce(true);
    confirmDeletion();
    await act(async () => {});
    if (timing === 'pending') {
      expect(document.activeElement).toBe(
        view.getByRole('button', { name: 'All conversations', exact: true })
      );
      await act(async () => {
        held.resolve(true);
        await held.promise;
      });
    }
    expect(
      view.queryByRole('button', { name: 'All conversations', exact: true })
    ).toBeNull();
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'New project', exact: true })
    );
    expect(JSON.parse(localStorage.getItem(key)!).projects).toEqual([]);
    expect(deletion.deleteProject).toHaveBeenCalledTimes(1);
  }
);

it('preserves focus chosen outside project controls while the last deletion completes', async () => {
  const { view, held, confirmDeletion } = setupLastProject();
  confirmDeletion();
  await act(async () => {});
  const draft = view.getByRole('textbox', { name: 'Draft' });
  draft.focus();
  fireEvent.change(draft, { target: { value: 'Keep this draft' } });
  await act(async () => {
    held.resolve(true);
    await held.promise;
  });
  expect(document.activeElement).toBe(draft);
  expect((draft as HTMLInputElement).value).toBe('Keep this draft');
  expect(
    view.queryByRole('button', { name: 'All conversations', exact: true })
  ).toBeNull();
});

it('keeps a focus target when immediate completion cannot save the project catalog', async () => {
  const { view, deletion, confirmDeletion } = setupLastProject();
  deletion.deleteProject.mockResolvedValueOnce(true);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  confirmDeletion();
  await act(async () => {});
  expect(view.getByRole('alert').textContent).toContain('project label');
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'All conversations', exact: true })
  );
});

function setup() {
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' p/x ', name: '<First>' },
        { id: '__proto__', name: 'Other' },
      ],
    })
  );
  const held = deferred();
  const deletion = {
    canDeleteProject: vi.fn(() => true),
    deleteProject: vi.fn((_id: string) => held.promise),
  };
  const select = vi.fn();
  const view = render(
    <NativeProjects
      rows={rows}
      projectId=" p/x "
      onSelect={select}
      deletion={deletion}
    />
  );
  return { view, deletion, held, select };
}
it('requires confirmation and captures exact target through filter changes; pending duplicates do not dispatch', async () => {
  const { view, deletion, held, select } = setup();
  fireEvent.click(
    view.getByRole('button', {
      name: 'More actions for project <First> ( p/x )',
      exact: true,
    })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  expect(deletion.deleteProject).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: 'Cancel', exact: true }));
  expect(deletion.deleteProject).not.toHaveBeenCalled();
  fireEvent.click(
    view.getByRole('button', {
      name: 'More actions for project <First> ( p/x )',
      exact: true,
    })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  const confirm = within(view.getByRole('alertdialog')).getByRole('button', {
    name: 'Delete project',
    exact: true,
  });
  fireEvent.click(confirm);
  fireEvent.click(confirm);
  expect(deletion.deleteProject).toHaveBeenCalledTimes(1);
  expect(deletion.deleteProject).toHaveBeenCalledWith(' p/x ');
  view.rerender(
    <NativeProjects
      rows={[]}
      projectId="__proto__"
      onSelect={select}
      deletion={deletion}
    />
  );
  await act(async () => {
    held.resolve(true);
    await held.promise;
  });
  expect(select).not.toHaveBeenCalled();
  expect(JSON.parse(localStorage.getItem(key)!).projects).toEqual([
    { id: '__proto__', name: 'Other' },
  ]);
  expect(view.getByText(/Project deleted: <First>/)).toBeTruthy();
});
it('retains label on uncertain backend result and explicitly retries the captured ID', async () => {
  const { view, deletion, held, select } = setup();
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project <First>/ })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.click(
    within(view.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete project',
      exact: true,
    })
  );
  await act(async () => {
    held.resolve(false);
    await held.promise;
  });
  expect(JSON.parse(localStorage.getItem(key)!).projects).toHaveLength(2);
  expect(select).not.toHaveBeenCalled();
  deletion.deleteProject.mockResolvedValueOnce(true);
  fireEvent.click(
    view.getByRole('button', { name: 'Retry project deletion', exact: true })
  );
  await act(async () => {});
  expect(deletion.deleteProject.mock.calls).toEqual([[' p/x '], [' p/x ']]);
  expect(select).toHaveBeenCalledWith(null);
});
it('keeps failed catalog persistence recoverable and rereads latest storage on retry', async () => {
  const { view, deletion, held } = setup();
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project <First>/ })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.click(
    within(view.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete project',
      exact: true,
    })
  );
  const original = Storage.prototype.setItem;
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('quota');
    });
  await act(async () => {
    held.resolve(true);
    await held.promise;
  });
  expect(view.getByRole('alert').textContent).toContain('project label');
  expect(JSON.parse(localStorage.getItem(key)!).projects).toHaveLength(2);
  write.mockImplementation(original);
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      projects: [
        { id: ' p/x ', name: 'Renamed elsewhere' },
        { id: 'new', name: 'Latest' },
      ],
    })
  );
  deletion.deleteProject.mockResolvedValueOnce(true);
  fireEvent.click(
    view.getByRole('button', { name: 'Retry project deletion', exact: true })
  );
  await act(async () => {});
  expect(JSON.parse(localStorage.getItem(key)!).projects).toEqual([
    { id: 'new', name: 'Latest' },
  ]);
  expect(deletion.deleteProject).toHaveBeenCalledTimes(2);
});
it('ignores completion after unmount or owner replacement', async () => {
  const { view, deletion, held, select } = setup();
  const outside = render(<button>Outside replacement</button>).getByRole(
    'button',
    { name: 'Outside replacement' }
  );
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project <First>/ })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.click(
    within(view.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete project',
      exact: true,
    })
  );
  const next = {
    canDeleteProject: () => true,
    deleteProject: vi.fn(async () => true),
  };
  outside.focus();
  view.rerender(
    <NativeProjects
      rows={rows}
      projectId=" p/x "
      onSelect={select}
      deletion={next}
    />
  );
  await act(async () => {
    held.resolve(true);
    await held.promise;
  });
  expect(JSON.parse(localStorage.getItem(key)!).projects).toHaveLength(2);
  expect(select).not.toHaveBeenCalled();
  expect(next.deleteProject).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(outside);
});

it('returns focus to All conversations after confirmation disables the original action', async () => {
  const { view, held } = setup();
  const trigger = view.getByRole('button', {
    name: /^More actions for project <First>/,
  });
  trigger.focus();
  fireEvent.click(trigger);
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  const confirm = within(view.getByRole('alertdialog')).getByRole('button', {
    name: 'Delete project',
    exact: true,
  });
  confirm.focus();
  fireEvent.click(confirm);
  await act(async () => {});
  expect(document.activeElement).toBe(
    view.getByRole('button', { name: 'All conversations', exact: true })
  );
  await act(async () => {
    held.resolve(false);
    await held.promise;
  });
});
it('does not remove the local label after an actual unmount', async () => {
  const { view, held, select } = setup();
  const outside = render(<button>Outside unmount</button>).getByRole('button', {
    name: 'Outside unmount',
  });
  fireEvent.click(
    view.getByRole('button', { name: /^More actions for project <First>/ })
  );
  fireEvent.click(view.getByRole('menuitem', { name: 'Delete' }));
  fireEvent.click(
    within(view.getByRole('alertdialog')).getByRole('button', {
      name: 'Delete project',
      exact: true,
    })
  );
  outside.focus();
  view.unmount();
  await act(async () => {
    held.resolve(true);
    await held.promise;
  });
  expect(JSON.parse(localStorage.getItem(key)!).projects).toHaveLength(2);
  expect(select).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(outside);
});
