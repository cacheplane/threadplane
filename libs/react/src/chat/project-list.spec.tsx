import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as chat from './index';

afterEach(cleanup);

describe('ProjectList', () => {
  it('provides the controlled project selection primitive', () => {
    expect(chat).toHaveProperty('ProjectList');
  });

  it('renders literal names in supplied order, selects exact IDs and updates only from props', () => {
    const ProjectList = chat.ProjectList;
    const projects = Object.freeze([
      Object.freeze({ id: ' p/b ', name: '<b>Beta</b>' }),
      Object.freeze({ id: 'a', name: '' }),
    ]);
    const onSelect = vi.fn();
    const view = render(
      <ProjectList
        projects={projects}
        activeProjectId="a"
        onSelect={onSelect}
      />
    );
    expect(view.getByRole('list', { name: 'Projects' })).toBeTruthy();
    const beta = view.getByRole('button', { name: '<b>Beta</b>' });
    expect(beta.querySelector('b')).toBeNull();
    expect(view.getAllByRole('listitem').map((row) => row.textContent)).toEqual(
      ['<b>Beta</b>', 'a']
    );
    expect(
      view.getByRole('button', { name: 'a' }).getAttribute('aria-current')
    ).toBe('true');
    fireEvent.click(beta);
    expect(onSelect.mock.calls).toEqual([[' p/b ']]);
    expect(beta.hasAttribute('aria-current')).toBe(false);
    beta.focus();
    view.rerender(
      <ProjectList
        projects={[projects[1], projects[0]]}
        activeProjectId=" p/b "
        onSelect={onSelect}
        label="Loaded projects"
        className="owner"
      />
    );
    expect(view.getByRole('button', { name: '<b>Beta</b>' })).toBe(beta);
    expect(document.activeElement).toBe(beta);
    expect(beta.getAttribute('aria-current')).toBe('true');
    expect(
      view
        .getByRole('list', { name: 'Loaded projects' })
        .classList.contains('owner')
    ).toBe(true);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('supports an optional app-owned new-project request and disabled state', () => {
    const ProjectList = chat.ProjectList;
    const onNewProject = vi.fn();
    const onSelect = vi.fn();
    const view = render(<ProjectList projects={[]} onSelect={onSelect} />);
    expect(view.queryByRole('button')).toBeNull();
    view.rerender(
      <ProjectList
        projects={[]}
        onSelect={onSelect}
        onNewProject={onNewProject}
      />
    );
    const button = view.getByRole('button', { name: '+ New project' });
    expect(button.getAttribute('type')).toBe('button');
    fireEvent.click(button);
    expect(onNewProject.mock.calls).toEqual([[]]);
    view.rerender(
      <ProjectList
        projects={[]}
        onSelect={onSelect}
        onNewProject={onNewProject}
        newProjectLabel="Create project"
        newProjectDisabled
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Create project' }));
    expect(onNewProject).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

it('composes app actions beside project selection without selecting or changing names', () => {
  const item = Object.freeze({ id: ' p ', name: '<Project>' });
  const onSelect = vi.fn(),
    command = vi.fn();
  const renderActions = vi.fn((project: chat.ProjectListItem) => (
    <button onClick={() => command(project.id)}>Rename {project.name}</button>
  ));
  const view = render(
    <chat.ProjectList
      projects={[item]}
      onSelect={onSelect}
      renderActions={renderActions}
    />
  );
  expect(renderActions.mock.calls[0][0]).toBe(item);
  const action = view.getByRole('button', { name: 'Rename <Project>' });
  expect(
    action
      .closest('li')
      ?.querySelector('.tp-project-list__button')
      ?.contains(action)
  ).toBe(false);
  fireEvent.click(action);
  expect(command).toHaveBeenCalledWith(' p ');
  expect(onSelect).not.toHaveBeenCalled();
  for (const empty of [null, false, undefined]) {
    view.rerender(
      <chat.ProjectList
        projects={[item]}
        onSelect={onSelect}
        renderActions={() => empty}
      />
    );
    expect(
      view.container.querySelector('.tp-project-list__actions')
    ).toBeNull();
  }
});
