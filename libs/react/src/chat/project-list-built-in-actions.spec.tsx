import {
  act,
  cleanup,
  fireEvent,
  render,
  type RenderResult,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ProjectList,
  type ProjectActionAdapter,
  type ProjectListProps,
} from './index';

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockImplementation(
    function (this: HTMLElement) {
      return [this.getBoundingClientRect()] as unknown as DOMRectList;
    }
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const projects = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
];

function deferred() {
  let resolve!: () => void;
  let reject!: (reason: Error) => void;
  const run = vi.fn(
    (..._args: string[]) =>
      new Promise<void>((yes, no) => {
        resolve = yes;
        reject = no;
      })
  );
  return {
    run,
    resolve: () => act(async () => resolve()),
    reject: () => act(async () => reject(new Error('refused'))),
  };
}
function choose(view: RenderResult, name: string, item: string) {
  fireEvent.click(
    view.getByRole('button', { name: `More actions for ${name}` })
  );
  fireEvent.click(view.getByRole('menuitem', { name: item }));
}
function rows(view: RenderResult) {
  return Array.from(
    view.container.querySelectorAll('.tp-project-list__button')
  ).map((button) => button.textContent);
}
function list(
  actions: ProjectActionAdapter | null,
  props: Partial<ProjectListProps> = {}
) {
  return render(
    <ProjectList
      projects={projects}
      onSelect={() => undefined}
      actions={actions}
      {...props}
    />
  );
}

describe('ProjectList built-in actions', () => {
  it('adds nothing without commands', () => {
    for (const actions of [null, {}]) {
      const view = list(actions);
      expect(view.queryByRole('button', { name: /More actions/ })).toBeNull();
      expect(view.queryByRole('button', { name: '+ New project' })).toBeNull();
      view.unmount();
    }
  });

  it('offers only the supplied row commands', () => {
    const view = list({ rename: vi.fn() });
    fireEvent.click(
      view.getByRole('button', { name: 'More actions for Alpha' })
    );
    expect(
      view.getAllByRole('menuitem').map((item) => item.textContent)
    ).toEqual(['Rename']);
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('renames inline with the new name shown while saving', async () => {
    const rename = deferred();
    const view = list({ rename: rename.run });
    choose(view, 'Beta', 'Rename');
    const input = view.getByRole('textbox', { name: 'Project name' });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: ' Briefs ' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(rename.run.mock.calls).toEqual([['b', 'Briefs']]);
    expect(rows(view)).toEqual(['Alpha', 'Briefs']);
    expect(document.activeElement).toBe(
      view.getByRole('button', { name: 'More actions for Briefs' })
    );
    await rename.reject();
    expect(rows(view)).toEqual(['Alpha', 'Beta']);
  });

  it('confirms before deleting and restores the row on rejection', async () => {
    const remove = deferred();
    const view = list({ delete: remove.run });
    choose(view, 'Alpha', 'Delete');
    expect(document.querySelector('dialog')?.textContent).toContain(
      'Delete project?'
    );
    fireEvent.click(view.getByRole('button', { name: 'Cancel' }));
    expect(remove.run).not.toHaveBeenCalled();
    choose(view, 'Alpha', 'Delete');
    fireEvent.click(view.getByRole('button', { name: 'Delete' }));
    expect(remove.run.mock.calls).toEqual([['a']]);
    expect(rows(view)).toEqual(['Beta']);
    await remove.reject();
    expect(rows(view)).toEqual(['Alpha', 'Beta']);
  });

  it('creates from an inline editor and returns focus to the button', () => {
    const create = vi.fn();
    const onNewProject = vi.fn();
    const view = list({ create }, { onNewProject });
    const button = view.getByRole('button', { name: '+ New project' });
    fireEvent.click(button);
    expect(onNewProject).toHaveBeenCalledOnce();
    const input = view.getByRole('textbox', { name: 'New project name' });
    expect(document.activeElement).toBe(input);
    expect(
      (view.getByRole('button', { name: 'Create' }) as HTMLButtonElement)
        .disabled
    ).toBe(true);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(view.queryByRole('textbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(create).not.toHaveBeenCalled();

    fireEvent.click(button);
    fireEvent.change(view.getByRole('textbox'), {
      target: { value: '  Launch ' },
    });
    fireEvent.click(view.getByRole('button', { name: 'Create' }));
    expect(create.mock.calls).toEqual([['Launch']]);
    expect(view.queryByRole('textbox')).toBeNull();
    expect(rows(view)).toEqual(['Alpha', 'Beta']);
  });

  it('keeps the application creation request when no create command is supplied', () => {
    const onNewProject = vi.fn();
    const view = list({ rename: vi.fn() }, { onNewProject });
    fireEvent.click(view.getByRole('button', { name: '+ New project' }));
    expect(onNewProject).toHaveBeenCalledOnce();
    expect(view.queryByRole('textbox')).toBeNull();
  });

  it('keeps application actions beside the built-in menu', () => {
    const view = list(
      { rename: vi.fn() },
      { renderActions: (project) => <button>Open {project.id}</button> }
    );
    expect(view.getByRole('button', { name: 'Open a' }).parentElement).toBe(
      view.getByRole('button', { name: 'More actions for Alpha' }).parentElement
    );
  });
});
