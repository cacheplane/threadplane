import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  ThreadList,
  useThreadRouting,
  type ThreadRouting,
  type ThreadRoutingAdapter,
  type ThreadRoutingOptions,
} from './index';

let latest: ThreadRouting | null = null;

function Probe(props: { options?: ThreadRoutingOptions }) {
  latest = useThreadRouting(props.options);
  return <output data-testid="thread">{latest.threadId ?? 'none'}</output>;
}

function shown(container: HTMLElement): string | null | undefined {
  return container.querySelector('output')?.textContent;
}

async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.history.replaceState(null, '', '/');
  latest = null;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

describe('useThreadRouting', () => {
  it('restores the active thread from the URL on load', () => {
    window.history.replaceState(null, '', '/abc123');
    const { container } = render(<Probe />);
    expect(shown(container)).toBe('abc123');
  });

  it('treats the bare URL as no thread and does not write', () => {
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const { container } = render(<Probe />);
    expect(shown(container)).toBe('none');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('pushes a new history entry when a thread is selected and keeps the query and hash', () => {
    window.history.replaceState(null, '', '/?mode=embed#top');
    const push = vi.spyOn(window.history, 'pushState');
    const { container } = render(<Probe />);
    act(() => latest!.setThreadId('xyz'));
    expect(push).toHaveBeenCalledTimes(1);
    expect(window.location.pathname).toBe('/xyz');
    expect(window.location.search).toBe('?mode=embed');
    expect(window.location.hash).toBe('#top');
    expect(shown(container)).toBe('xyz');

    act(() => latest!.setThreadId(null));
    expect(window.location.pathname).toBe('/');
    expect(shown(container)).toBe('none');
  });

  it('does not write when the selected thread is already active', () => {
    window.history.replaceState(null, '', '/same');
    const push = vi.spyOn(window.history, 'pushState');
    render(<Probe />);
    act(() => latest!.setThreadId('same'));
    expect(push).not.toHaveBeenCalled();
  });

  it('wires ThreadList selection to the URL', () => {
    function Sidebar() {
      const { threadId, setThreadId } = useThreadRouting();
      return (
        <ThreadList
          threads={[{ id: 'a', title: 'Portland' }, { id: 'b', title: 'Lisbon' }]}
          activeThreadId={threadId}
          onSelect={setThreadId}
        />
      );
    }
    const { getByText } = render(<Sidebar />);
    fireEvent.click(getByText('Lisbon'));
    expect(window.location.pathname).toBe('/b');
    expect(getByText('Lisbon').closest('button')?.getAttribute('aria-current')).toBe('true');
  });

  it('follows back and forward navigation', () => {
    const { container } = render(<Probe />);
    act(() => latest!.setThreadId('first'));
    act(() => latest!.setThreadId('second'));
    act(() => {
      window.history.replaceState(null, '', '/first');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(shown(container)).toBe('first');
  });

  it('reads a query parameter when one is configured', () => {
    window.history.replaceState(null, '', '/chat?thread=t1&x=1');
    const { container } = render(<Probe options={{ param: 'thread' }} />);
    expect(shown(container)).toBe('t1');
    act(() => latest!.setThreadId('t2'));
    expect(window.location.pathname).toBe('/chat');
    expect(new URLSearchParams(window.location.search).get('thread')).toBe('t2');
    expect(new URLSearchParams(window.location.search).get('x')).toBe('1');
    act(() => latest!.setThreadId(null));
    expect(window.location.search).toBe('?x=1');
  });

  it('reads the segment after a base path', () => {
    window.history.replaceState(null, '', '/embed/t1');
    const { container } = render(<Probe options={{ basePath: '/embed' }} />);
    expect(shown(container)).toBe('t1');
    act(() => latest!.setThreadId('t 2'));
    expect(window.location.pathname).toBe('/embed/t%202');
    expect(shown(container)).toBe('t 2');
    act(() => latest!.setThreadId(null));
    expect(window.location.pathname).toBe('/embed');
  });

  it('trims any number of trailing slashes from the base path', () => {
    window.history.replaceState(null, '', '/chat/t1');
    const { container } = render(
      <Probe options={{ basePath: 'chat' + '/'.repeat(10000) }} />,
    );
    expect(shown(container)).toBe('t1');
    act(() => latest!.setThreadId(null));
    expect(window.location.pathname).toBe('/chat');
  });

  it('ignores paths outside the base path', () => {
    window.history.replaceState(null, '', '/settings/profile');
    const { container } = render(<Probe options={{ basePath: '/embed' }} />);
    expect(shown(container)).toBe('none');
    cleanup();
    window.history.replaceState(null, '', '/embed/t1/details');
    const nested = render(<Probe options={{ basePath: '/embed' }} />);
    expect(shown(nested.container)).toBe('none');
  });

  it('replaces a missing thread with the bare URL', async () => {
    window.history.replaceState(null, '', '/dead?keep=1');
    const push = vi.spyOn(window.history, 'pushState');
    const replace = vi.spyOn(window.history, 'replaceState');
    const exists = vi.fn(async () => false);
    const { container } = render(<Probe options={{ exists }} />);
    await flush();
    expect(exists).toHaveBeenCalledWith('dead');
    expect(replace).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe('/');
    expect(window.location.search).toBe('?keep=1');
    expect(shown(container)).toBe('none');
  });

  it('accepts a synchronous existence check and keeps a valid thread', async () => {
    window.history.replaceState(null, '', '/live');
    const exists = vi.fn((id: string) => id === 'live');
    const { container } = render(<Probe options={{ exists }} />);
    await flush();
    expect(shown(container)).toBe('live');
    expect(window.location.pathname).toBe('/live');
  });

  it('checks each thread once until another is selected, and ignores late answers', async () => {
    window.history.replaceState(null, '', '/a');
    let resolveA: (ok: boolean) => void = () => undefined;
    const exists = vi.fn((id: string) =>
      id === 'a' ? new Promise<boolean>((r) => (resolveA = r)) : true,
    );
    const { container, rerender } = render(<Probe options={{ exists }} />);
    rerender(<Probe options={{ exists }} />);
    expect(exists).toHaveBeenCalledTimes(1);
    act(() => latest!.setThreadId('b'));
    await act(async () => resolveA(false));
    expect(shown(container)).toBe('b');
    expect(window.location.pathname).toBe('/b');
  });

  it('keeps the thread when the existence check fails', async () => {
    window.history.replaceState(null, '', '/flaky');
    const exists = vi.fn(async () => {
      throw new Error('offline');
    });
    const { container } = render(<Probe options={{ exists }} />);
    await flush();
    expect(shown(container)).toBe('flaky');
  });

  it('uses a custom adapter in place of the browser location', async () => {
    let current: string | null = 'r1';
    const listeners = new Set<() => void>();
    const writes: [string | null, string][] = [];
    const adapter: ThreadRoutingAdapter = {
      read: () => current,
      write: (id, mode) => {
        writes.push([id, mode]);
        current = id;
      },
      subscribe: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
    };
    const push = vi.spyOn(window.history, 'pushState');
    const { container, unmount } = render(
      <Probe options={{ adapter, exists: (id) => id !== 'gone' }} />,
    );
    expect(shown(container)).toBe('r1');

    act(() => latest!.setThreadId('r2'));
    expect(writes).toEqual([['r2', 'push']]);
    expect(shown(container)).toBe('r2');

    act(() => {
      current = 'gone';
      listeners.forEach((cb) => cb());
    });
    await flush();
    expect(writes).toEqual([
      ['r2', 'push'],
      [null, 'replace'],
    ]);
    expect(shown(container)).toBe('none');
    expect(push).not.toHaveBeenCalled();

    unmount();
    expect(listeners.size).toBe(0);
  });

  it('renders on the server without touching window', () => {
    vi.stubGlobal('window', undefined);
    const html = renderToString(<Probe />);
    expect(html).toContain('none');
  });

  it('renders the server snapshot during hydration of a thread URL', () => {
    window.history.replaceState(null, '', '/abc');
    const location = vi.spyOn(window, 'location', 'get');
    renderToString(<Probe />);
    expect(location).not.toHaveBeenCalled();
  });
});
