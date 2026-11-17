// libs/chat/src/lib/compositions/chat-thread-sidebar/chat-thread-sidebar.component.spec.ts
import { Component, signal, type WritableSignal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Agent, AgentStatus } from '../../agent';
import type {
  ThreadDirectory,
  ThreadDirectorySnapshot,
} from '../../thread-directory/thread-directory';
import {
  ChatThreadRowTemplateDirective,
  ChatThreadSidebarComponent,
  type ThreadSidebarFeatures,
} from './chat-thread-sidebar.component';

const loaded: ThreadDirectorySnapshot = Object.freeze({
  threads: Object.freeze([
    { id: 'a', title: 'Alpha', pinned: true, archived: false, projectId: null },
    { id: 'b', title: 'Beta', pinned: false, archived: false, projectId: null },
  ]),
  archived: Object.freeze([]),
  projects: Object.freeze([{ id: 'p', name: 'Research' }]),
  status: 'idle',
});

type Fake = ThreadDirectory & {
  set(next: ThreadDirectorySnapshot): void;
  readonly listeners: Set<() => void>;
  readonly refresh: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
};

/** A hand-written directory; `omit` drops optional commands. */
function fakeDirectory(
  initial: ThreadDirectorySnapshot = loaded,
  omit: readonly (keyof ThreadDirectory)[] = []
): Fake {
  let snapshot = initial;
  const listeners = new Set<() => void>();
  const directory: Record<string, unknown> = {
    listeners,
    getSnapshot: () => snapshot,
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    refresh: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'new' })),
    rename: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
    setArchived: vi.fn(async () => undefined),
    setPinned: vi.fn(async () => undefined),
    reorderPinned: vi.fn(async () => undefined),
    setProject: vi.fn(async () => undefined),
    createProject: vi.fn(async () => ({ id: 'q' })),
    renameProject: vi.fn(async () => undefined),
    removeProject: vi.fn(async () => undefined),
    dispose: vi.fn(),
    set(next: ThreadDirectorySnapshot) {
      snapshot = next;
      for (const notify of [...listeners]) notify();
    },
  };
  for (const key of omit) delete directory[key];
  return directory as unknown as Fake;
}

function fakeAgent(status: AgentStatus): {
  agent: Agent;
  status: WritableSignal<AgentStatus>;
} {
  const current = signal<AgentStatus>(status);
  return { agent: { status: current } as unknown as Agent, status: current };
}

interface Inputs {
  directory: ThreadDirectory;
  agent?: Agent;
  activeThreadId?: string | null;
  features?: ThreadSidebarFeatures;
  labels?: Record<string, string>;
  extraActions?: readonly {
    id: string;
    label: string;
    run: (threadId: string) => void | Promise<void>;
  }[];
}

function render(inputs: Inputs): ComponentFixture<ChatThreadSidebarComponent> {
  const fixture = TestBed.createComponent(ChatThreadSidebarComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  TestBed.tick();
  return fixture;
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function text(fixture: ComponentFixture<unknown>): string {
  return (fixture.nativeElement as HTMLElement).textContent ?? '';
}

function rowButton(
  fixture: ComponentFixture<unknown>,
  title: string
): HTMLButtonElement | undefined {
  return Array.from(
    (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
      '.chat-thread-list__item'
    )
  ).find((button) => button.getAttribute('title') === title);
}

function openMenu(fixture: ComponentFixture<unknown>, title: string): void {
  const row = rowButton(fixture, title);
  if (!row) throw new Error(`no row ${title}`);
  const kebab = row.parentElement?.querySelector<HTMLButtonElement>(
    '.chat-thread-list__kebab'
  );
  if (!kebab) throw new Error(`no menu for ${title}`);
  kebab.click();
  fixture.detectChanges();
}

function menuEntries(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>('.chat-overflow-menu__item')
  );
}

function menuItems(fixture: ComponentFixture<unknown>, title: string) {
  openMenu(fixture, title);
  return menuEntries().map((item) => item.textContent?.trim());
}

function chooseMenuItem(fixture: ComponentFixture<unknown>, label: string) {
  const item = menuEntries().find((el) => el.textContent?.trim() === label);
  if (!item) throw new Error(`no menu item ${label}`);
  item.click();
  fixture.detectChanges();
}

async function deleteRow(fixture: ComponentFixture<unknown>, title: string) {
  openMenu(fixture, title);
  chooseMenuItem(fixture, 'Delete');
  (
    document.querySelector('.chat-confirm-dialog__confirm') as HTMLElement
  ).click();
  fixture.detectChanges();
  await flush();
  fixture.detectChanges();
}

function newChatButton(fixture: ComponentFixture<unknown>) {
  return (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
    '.chat-thread-sidebar__new'
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ChatThreadSidebarComponent', () => {
  it('lists threads from the directory and refreshes on mount', () => {
    const directory = fakeDirectory();
    const fixture = render({ directory });
    expect(rowButton(fixture, 'Alpha')).toBeDefined();
    expect(rowButton(fixture, 'Beta')).toBeDefined();
    expect(directory.refresh).toHaveBeenCalledTimes(1);
    expect(directory.refresh.mock.calls[0][0]?.signal).toBeInstanceOf(
      AbortSignal
    );
    directory.set({ ...loaded, threads: [loaded.threads[1]] });
    fixture.detectChanges();
    expect(rowButton(fixture, 'Alpha')).toBeUndefined();
  });

  it('hides menu actions the directory lacks', () => {
    const full = render({ directory: fakeDirectory() });
    expect(menuItems(full, 'Beta')).toContain('Delete');
    full.destroy();
    const fixture = render({
      directory: fakeDirectory(loaded, ['remove', 'setPinned']),
    });
    const items = menuItems(fixture, 'Beta');
    expect(items).not.toContain('Delete');
    expect(items).not.toContain('Pin');
    expect(items).toContain('Rename');
  });

  it('turns built-ins off with features', () => {
    const fixture = render({
      directory: fakeDirectory(),
      features: { projects: false, rename: false, archive: false },
    });
    expect(text(fixture)).not.toContain('Projects');
    expect(text(fixture)).not.toContain('Research');
    expect(text(fixture)).not.toContain('Archived');
    const items = menuItems(fixture, 'Beta');
    expect(items).not.toContain('Rename');
    expect(items).not.toContain('Archive');
    expect(items).not.toContain('Move to project');
    expect(items).toContain('Delete');
  });

  it('shows the load error and retries', () => {
    const directory = fakeDirectory({
      threads: [],
      archived: [],
      status: 'error',
      error: { kind: 'connection', message: 'offline', retryable: true },
    });
    const fixture = render({
      directory,
      labels: { loadError: 'Could not load chats', retry: 'Try again' },
    });
    const alert = (fixture.nativeElement as HTMLElement).querySelector(
      '[role="alert"]'
    );
    expect(alert?.textContent).toContain('Could not load chats');
    expect(text(fixture)).not.toContain('No conversations yet.');
    const retry = Array.from(
      alert?.querySelectorAll('button') ?? []
    ).find((button) => button.textContent?.trim() === 'Try again');
    retry?.click();
    expect(directory.refresh).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state only once loaded', () => {
    const directory = fakeDirectory({
      threads: [],
      archived: [],
      status: 'loading',
    });
    const fixture = render({ directory });
    const host = fixture.nativeElement as HTMLElement;
    expect(text(fixture)).not.toContain('No conversations yet.');
    expect(host.getAttribute('aria-busy')).toBe('true');
    directory.set({ threads: [], archived: [], status: 'idle' });
    fixture.detectChanges();
    expect(text(fixture)).toContain('No conversations yet.');
    expect(host.hasAttribute('aria-busy')).toBe(false);
  });

  it('refreshes after a run ends', () => {
    const directory = fakeDirectory();
    const run = fakeAgent('running');
    const fixture = render({ directory, agent: run.agent });
    expect(directory.refresh).toHaveBeenCalledTimes(1);
    run.status.set('idle');
    TestBed.tick();
    expect(directory.refresh).toHaveBeenCalledTimes(2);
    run.status.set('idle');
    TestBed.tick();
    expect(directory.refresh).toHaveBeenCalledTimes(2);
    const signal = directory.refresh.mock.calls[0][0]?.signal as AbortSignal;
    fixture.destroy();
    expect(signal.aborted).toBe(true);
    expect(directory.listeners.size).toBe(0);
    expect(directory.dispose).not.toHaveBeenCalled();
  });

  it('reports the active thread removed', async () => {
    const directory = fakeDirectory();
    const fixture = render({ directory, activeThreadId: 'b' });
    const removed = vi.fn();
    fixture.componentInstance.activeThreadRemoved.subscribe(removed);
    await deleteRow(fixture, 'Beta');
    expect(directory.remove).toHaveBeenCalledWith('b');
    expect(removed).toHaveBeenCalledTimes(1);
  });

  it('does not report a failed or inactive removal', async () => {
    const directory = fakeDirectory();
    (directory.remove as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('refused')
    );
    const fixture = render({ directory, activeThreadId: 'b' });
    const removed = vi.fn();
    fixture.componentInstance.activeThreadRemoved.subscribe(removed);
    for (const title of ['Beta', 'Alpha']) await deleteRow(fixture, title);
    expect(directory.remove).toHaveBeenCalledTimes(2);
    expect(removed).not.toHaveBeenCalled();
    expect(rowButton(fixture, 'Beta')).toBeDefined();
  });

  it('creates and selects a new chat by default', async () => {
    const directory = fakeDirectory();
    const fixture = render({ directory });
    const selected = vi.fn();
    fixture.componentInstance.threadSelected.subscribe(selected);
    newChatButton(fixture)?.click();
    await flush();
    expect(directory.create).toHaveBeenCalledTimes(1);
    expect(selected.mock.calls).toEqual([['new']]);
  });

  it('emits newChat instead of creating when it has a listener', async () => {
    const directory = fakeDirectory();
    const fixture = render({ directory });
    const newChat = vi.fn();
    fixture.componentInstance.newChat.subscribe(newChat);
    newChatButton(fixture)?.click();
    await flush();
    expect(newChat).toHaveBeenCalledTimes(1);
    expect(directory.create).not.toHaveBeenCalled();
  });

  it('settles a rejected default new chat', async () => {
    const directory = fakeDirectory();
    (directory.create as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('refused')
    );
    const fixture = render({ directory });
    const selected = vi.fn();
    fixture.componentInstance.threadSelected.subscribe(selected);
    newChatButton(fixture)?.click();
    await flush();
    expect(selected).not.toHaveBeenCalled();
  });

  it('omits New chat without a handler or create command', () => {
    const fixture = render({ directory: fakeDirectory(loaded, ['create']) });
    expect(newChatButton(fixture)).toBeNull();
  });

  it('renders before and after sections and a custom row', () => {
    const fixture = TestBed.createComponent(CustomRowHost);
    fixture.componentInstance.directory = fakeDirectory();
    fixture.detectChanges();
    const content = text(fixture);
    expect(content.indexOf('Before')).toBeLessThan(content.indexOf('Chats'));
    expect(content.indexOf('Chats')).toBeLessThan(content.indexOf('After'));
    expect(content).toContain('row Alpha active');
    expect(content).toContain('row Beta');
    expect(content).not.toContain('row Beta active');
    const host = fixture.nativeElement as HTMLElement;
    expect(host.querySelector('.chat-thread-list__kebab')).toBeNull();
    host
      .querySelector('.chat-thread-list__item-wrap')
      ?.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
      );
    fixture.detectChanges();
    expect(menuEntries()).toEqual([]);
    fixture.destroy();

    const run = vi.fn();
    const extra = render({
      directory: fakeDirectory(),
      extraActions: [{ id: 'share', label: 'Share', run }],
    });
    openMenu(extra, 'Beta');
    chooseMenuItem(extra, 'Share');
    expect(run).toHaveBeenCalledWith('b');
  });
});

@Component({
  standalone: true,
  imports: [ChatThreadSidebarComponent, ChatThreadRowTemplateDirective],
  template: `
    <chat-thread-sidebar
      [directory]="directory"
      activeThreadId="a"
      [labels]="{ recent: 'Chats' }"
    >
      <p chatThreadSidebarBefore>Before</p>
      <ng-template chatThreadRow let-thread let-isActive="isActive">
        <span>row {{ thread.title }}{{ isActive ? ' active' : '' }}</span>
      </ng-template>
      <p chatThreadSidebarAfter>After</p>
    </chat-thread-sidebar>
  `,
})
class CustomRowHost {
  directory!: ThreadDirectory;
}
