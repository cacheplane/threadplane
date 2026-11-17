import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChatSidenav, ChatSidenavSections, type ThreadListItem } from './index';

beforeEach(() => {
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

const threads: readonly ThreadListItem[] = [
  { id: 'a', title: 'Alpha', pinned: true },
  { id: 'b', title: 'Beta' },
];
const archived: readonly ThreadListItem[] = [{ id: 'z', title: 'Zeta' }];
const projects = [{ id: 'p', name: 'Research' }];

describe('ChatSidenavSections', () => {
  it('renders only an empty container when given nothing', () => {
    const view = render(<ChatSidenavSections />);
    const root = view.container.firstElementChild!;
    expect(root.className).toBe('tp-chat-sidenav-sections');
    expect(root.childElementCount).toBe(0);
  });

  it('shows New chat only with a handler and calls it without arguments', () => {
    const onNewChat = vi.fn();
    const view = render(<ChatSidenavSections onNewChat={onNewChat} />);
    fireEvent.click(view.getByRole('button', { name: 'New chat' }));
    expect(onNewChat).toHaveBeenCalledWith();
  });

  it('lists projects, then recent conversations, each under a named section', () => {
    const view = render(
      <ChatSidenavSections threads={threads} projects={projects} />
    );
    const sections = view.getAllByRole('region');
    expect(sections.map((section) => section.getAttribute('aria-labelledby') && view.container.ownerDocument.getElementById(section.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Projects', 'Recent']);
    expect(view.getByRole('button', { name: 'Research' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'Alpha' })).not.toBeNull();
    expect(view.getByRole('button', { name: 'Beta' })).not.toBeNull();
  });

  it('reports the chosen conversation and project and marks the active ones', () => {
    const onThreadSelect = vi.fn();
    const onProjectSelect = vi.fn();
    const view = render(
      <ChatSidenavSections
        threads={threads}
        projects={projects}
        activeThreadId="b"
        selectedProjectId="p"
        onThreadSelect={onThreadSelect}
        onProjectSelect={onProjectSelect}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'Alpha' }));
    fireEvent.click(view.getByRole('button', { name: 'Research' }));
    expect(onThreadSelect.mock.calls).toEqual([['a']]);
    expect(onProjectSelect.mock.calls).toEqual([['p']]);
    expect(view.getByRole('button', { name: 'Beta' }).getAttribute('aria-current')).toBeTruthy();
    expect(view.getByRole('button', { name: 'Research' }).getAttribute('aria-current')).toBeTruthy();
  });

  it('keeps archived conversations collapsed until asked, and lists them in archived mode', () => {
    const unarchive = vi.fn(async () => undefined);
    const view = render(
      <ChatSidenavSections
        threads={threads}
        archivedThreads={archived}
        threadActions={{ unarchive, archive: vi.fn() }}
      />
    );
    const toggle = view.getByRole('button', { name: 'Archived' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByRole('button', { name: 'Zeta' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const panel = view.container.ownerDocument.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(false);
    expect(view.getByRole('button', { name: 'Zeta' })).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'More actions for Zeta' }));
    expect(view.getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Unarchive']);
    fireEvent.click(toggle);
    expect(view.queryByRole('button', { name: 'Zeta' })).toBeNull();
  });

  it('says so when there are no archived conversations', () => {
    const view = render(<ChatSidenavSections archivedThreads={[]} />);
    fireEvent.click(view.getByRole('button', { name: 'Archived' }));
    expect(view.getByText('No archived conversations.')).not.toBeNull();
  });

  it('offers projects as move destinations and the built-in new project control', () => {
    const moveToProject = vi.fn(async () => undefined);
    const view = render(
      <ChatSidenavSections
        threads={threads}
        projects={projects}
        threadActions={{ moveToProject }}
        projectActions={{ create: vi.fn(async () => undefined) }}
      />
    );
    fireEvent.click(view.getByRole('button', { name: 'More actions for Beta' }));
    fireEvent.click(view.getByRole('menuitem', { name: 'Move to project' }));
    fireEvent.click(view.getByRole('menuitem', { name: 'Research' }));
    expect(moveToProject.mock.calls).toEqual([['b', 'p']]);
    expect(view.getByRole('button', { name: /New project/ })).not.toBeNull();
  });

  it('uses supplied labels and renders app content last', () => {
    const view = render(
      <ChatSidenavSections
        threads={threads}
        archivedThreads={[]}
        onNewChat={() => undefined}
        newChatLabel="Neuer Chat"
        recentLabel="Aktuell"
        archivedLabel="Archiv"
        archivedEmptyLabel="Nichts archiviert."
      >
        <p>Extra</p>
      </ChatSidenavSections>
    );
    expect(view.getByRole('button', { name: 'Neuer Chat' })).not.toBeNull();
    expect(view.getByRole('heading', { name: 'Aktuell' })).not.toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Archiv' }));
    expect(view.getByText('Nichts archiviert.')).not.toBeNull();
    expect(view.container.firstElementChild?.lastElementChild?.textContent).toBe('Extra');
  });

  it('sits inside ChatSidenav and is hidden with its body when collapsed', () => {
    const shell = (mode: 'expanded' | 'collapsed') => (
      <ChatSidenav
        mode={mode}
        open={false}
        onOpenChange={() => undefined}
        onModeChange={() => undefined}
      >
        <ChatSidenavSections threads={threads} />
      </ChatSidenav>
    );
    const view = render(shell('expanded'));
    const sections = view.container.querySelector('.tp-chat-sidenav-sections')!;
    expect(sections.closest('.tp-chat-sidenav__body')?.hasAttribute('hidden')).toBe(false);
    view.rerender(shell('collapsed'));
    expect(sections.closest('.tp-chat-sidenav__body')?.hasAttribute('hidden')).toBe(true);
    expect(view.container.querySelector('.tp-chat-sidenav-sections')).toBe(sections);
  });
});
