import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatDebug } from '../debug/chat-debug';
import { ChatSidenav, type ChatSidenavDevtools } from './index';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.resetModules();
  localStorage.clear();
});

type Status = 'idle' | 'running';

function fakeSession(status: Status = 'idle') {
  let current = { status };
  const listeners = new Set<() => void>();
  return {
    getSnapshot: () => current,
    subscribe(notify: () => void) {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    set(next: Status) {
      current = { status: next };
      listeners.forEach((notify) => notify());
    },
  };
}

const devtools = (
  session: ReturnType<typeof fakeSession>
): ChatSidenavDevtools => ({
  session,
  render: (panel) => (
    <ChatDebug
      {...panel}
      contextKey="owner"
      current={{ contextKey: 'owner', status: 'unknown' }}
    />
  ),
});

const shell = (props: Partial<Parameters<typeof ChatSidenav>[0]> = {}) => (
  <ChatSidenav
    mode="expanded"
    open={false}
    onOpenChange={vi.fn()}
    onModeChange={vi.fn()}
    {...props}
  >
    <p>Threads</p>
  </ChatSidenav>
);

describe('ChatSidenav devtools', () => {
  it('shows no Devtools button without the prop', () => {
    const view = render(shell());
    expect(view.queryByRole('button', { name: /devtools/i })).toBeNull();
  });

  it('shows a Devtools button with the prop and no panel until pressed', () => {
    const view = render(shell({ devtools: devtools(fakeSession()) }));
    expect(
      view.getByRole('button', { name: 'Open chat devtools' })
    ).toBeTruthy();
    expect(view.queryByRole('region', { name: 'Chat debug' })).toBeNull();
    expect(view.queryByRole('button', { name: /debug panel/i })).toBeNull();
  });

  it('reflects a running session in the streaming dot', () => {
    const session = fakeSession();
    const view = render(shell({ devtools: devtools(session) }));
    const dot = () =>
      view.container.querySelector('.tp-chat-sidenav__devtools-dot');
    expect(dot()?.getAttribute('data-streaming')).toBe('false');
    act(() => session.set('running'));
    expect(dot()?.getAttribute('data-streaming')).toBe('true');
    act(() => session.set('idle'));
    expect(dot()?.getAttribute('data-streaming')).toBe('false');
  });

  it('opens the debug panel docked to the bottom when pressed', () => {
    const view = render(shell({ devtools: devtools(fakeSession()) }));
    const button = view.getByRole('button', { name: 'Open chat devtools' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    const panel = view.getByRole('region', { name: 'Chat debug' });
    expect(panel.getAttribute('data-dock')).toBe('bottom');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('closes the panel from its own close button and returns focus to the button', () => {
    const view = render(shell({ devtools: devtools(fakeSession()) }));
    const button = view.getByRole('button', { name: 'Open chat devtools' });
    fireEvent.click(button);
    fireEvent.click(view.getByRole('button', { name: 'Close debug panel' }));
    expect(view.queryByRole('region', { name: 'Chat debug' })).toBeNull();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(button);
  });

  it('keeps the button but hides the label in collapsed mode', () => {
    const view = render(
      shell({ mode: 'collapsed', devtools: devtools(fakeSession()) })
    );
    expect(
      view.getByRole('button', { name: 'Open chat devtools' })
    ).toBeTruthy();
    expect(view.queryByText('Devtools')).toBeNull();
  });

  it('renders nothing in production builds', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.resetModules();
    const production = await import('./chat-sidenav');
    const view = render(
      <production.ChatSidenav
        mode="expanded"
        open={false}
        onOpenChange={vi.fn()}
        onModeChange={vi.fn()}
        devtools={devtools(fakeSession())}
      >
        <p>Threads</p>
      </production.ChatSidenav>
    );
    expect(view.queryByRole('button', { name: /devtools/i })).toBeNull();
  });
});
