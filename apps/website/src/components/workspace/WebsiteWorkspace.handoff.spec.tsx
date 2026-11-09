/** @vitest-environment jsdom */
import React, { StrictMode, useState } from 'react';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WebsiteWorkspaceProps } from './WebsiteWorkspaceSurface';

vi.mock('./WebsiteWorkspaceSurface', () => ({
  WebsiteWorkspaceSurface: (props: WebsiteWorkspaceProps) => props.docsSlot,
}));
import { WebsiteWorkspace } from './WebsiteWorkspace';
import { WebsiteWorkspaceLayoutContext } from './WebsiteWorkspaceRoot';

const props: WebsiteWorkspaceProps = {
  resolution: {
    kind: 'docs-only',
    docsPath: '/docs/testing',
    title: 'Testing',
    unavailableReason: 'no-workspace-capability',
  },
  presentation: {
    kind: 'docs-only',
    docsPath: '/docs/testing',
    title: 'Testing',
    runnable: false,
  },
  contentBundle: {
    codeFiles: {},
    codeSources: {},
    promptFiles: {},
    runtimeUrl: null,
    docSections: [],
  },
  navigationTree: [],
  routePath: '/docs/testing',
};

function layout() {
  const register = vi.fn();
  const unregister = vi.fn();
  function Harness({ children }: { children: React.ReactNode }) {
    const [active, setActive] = useState<{
      token: object;
      props: WebsiteWorkspaceProps;
    } | null>(null);
    const callbacks = React.useMemo(
      () => ({
        register: (token: object, next: WebsiteWorkspaceProps) => {
          register(token, next);
          setActive({ token, props: next });
        },
        unregister: (token: object) => {
          unregister(token);
          setActive((current) => (current?.token === token ? null : current));
        },
      }),
      []
    );
    return (
      <WebsiteWorkspaceLayoutContext.Provider
        value={{ activeToken: active?.token ?? null, ...callbacks }}
      >
        {active?.props.docsSlot}
        {children}
      </WebsiteWorkspaceLayoutContext.Provider>
    );
  }
  return { Harness, register, unregister };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('initial docs article handoff', () => {
  it('restores a disclosure when the remounted article content arrives later', async () => {
    const { Harness } = layout();
    let mounts = 0;
    let reveal: (() => void) | undefined;
    function Article() {
      const [ready, setReady] = useState(() => ++mounts === 1);
      reveal = () => setReady(true);
      return ready ? (
        <details
          ref={(node) => {
            if (node && mounts === 1) node.open = true;
          }}
        >
          <summary>Delayed install</summary>
          <p>npm install example</p>
        </details>
      ) : null;
    }
    render(
      <Harness>
        <WebsiteWorkspace {...props} docsSlot={<Article />} />
      </Harness>
    );
    expect(screen.queryByText('Delayed install')).toBeNull();
    act(() => reveal?.());
    await waitFor(() =>
      expect(screen.getByText('Delayed install').closest('details')?.open).toBe(
        true
      )
    );
  });

  it.each([false, true])(
    'preserves the visitor disclosure state from default open=%s only once',
    (defaultOpen) => {
      const { Harness } = layout();
      let original: HTMLDetailsElement | null = null;
      const docsSlot = (
        <article>
          <details
            open={defaultOpen}
            ref={(node) => {
              if (node && !original) {
                original = node;
                node.open = !defaultOpen;
              }
            }}
          >
            <summary>Install command</summary>
            <p>npm install example</p>
          </details>
        </article>
      );
      const view = render(
        <Harness>
          <WebsiteWorkspace {...props} docsSlot={docsSlot} />
        </Harness>
      );
      const disclosure = screen.getByText('Install command').closest('details');
      expect(disclosure).not.toBe(original);
      expect(disclosure?.open).toBe(!defaultOpen);
      if (!disclosure) throw new Error('Missing installed disclosure');
      act(() => {
        disclosure.open = defaultOpen;
      });
      view.rerender(
        <Harness>
          <WebsiteWorkspace {...props} docsSlot={docsSlot} contextTrail={[]} />
        </Harness>
      );
      expect(screen.getByText('Install command').closest('details')?.open).toBe(
        defaultOpen
      );
    }
  );

  it('retains a focused fallback anchor and native activation until focus leaves', () => {
    vi.useFakeTimers();
    const { Harness, register } = layout();
    let original: HTMLAnchorElement | null = null;
    render(
      <Harness>
        <WebsiteWorkspace
          {...props}
          docsSlot={
            <article>
              <a
                href="#next"
                ref={(node) => {
                  if (node && !original) {
                    original = node;
                    node.focus();
                  }
                }}
              >
                <span>Next</span>
              </a>
            </article>
          }
        />
      </Harness>
    );
    expect(register).not.toHaveBeenCalled();
    expect(screen.getByRole('link')).toBe(original);
    const click = new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
    });
    act(() => original?.dispatchEvent(click));
    expect(click.defaultPrevented).toBe(false);
    fireEvent.keyUp(screen.getByRole('link'), { key: 'Enter' });
    act(() => vi.runOnlyPendingTimers());
    expect(register).not.toHaveBeenCalled();
    act(() => original?.blur());
    expect(register).not.toHaveBeenCalled();
    act(() => vi.runOnlyPendingTimers());
    expect(register).toHaveBeenCalledTimes(1);
  });

  it.each(['pointerup', 'pointercancel', 'blur'])(
    'retains a pointer-active link through %s defaults',
    (event) => {
      vi.useFakeTimers();
      const { Harness, register } = layout();
      let active = true;
      let original: HTMLAnchorElement | null = null;
      render(
        <Harness>
          <WebsiteWorkspace
            {...props}
            docsSlot={
              <article>
                <a
                  href="#next"
                  ref={(node) => {
                    if (!node || original) return;
                    original = node;
                    // jsdom has no pointer-driven CSS :active state. Supply that browser state
                    // on this fallback host while keeping focus and event dispatch real.
                    const host = node.parentElement?.parentElement;
                    if (!host)
                      throw new Error('Expected a connected fallback host');
                    const query = host.querySelector.bind(host);
                    vi.spyOn(host, 'querySelector').mockImplementation(
                      (selector) =>
                        selector === 'a[href]:active'
                          ? active
                            ? node
                            : null
                          : query(selector)
                    );
                  }}
                >
                  <span>Next</span>
                </a>
              </article>
            }
          />
        </Harness>
      );
      expect(document.activeElement).toBe(document.body);
      expect(register).not.toHaveBeenCalled();
      const release = new Event(event, { bubbles: true, cancelable: true });
      act(() =>
        (event === 'blur' ? window : screen.getByText('Next')).dispatchEvent(
          release
        )
      );
      expect(release.defaultPrevented).toBe(false);
      expect(screen.getByRole('link')).toBe(original);
      expect(register).not.toHaveBeenCalled();
      active = false;
      act(() => vi.runOnlyPendingTimers());
      expect(register).toHaveBeenCalledTimes(1);
      act(() => {
        document.dispatchEvent(new Event(event));
        vi.runOnlyPendingTimers();
      });
      expect(register).toHaveBeenCalledTimes(1);
    }
  );

  it('detects focus inside an anchor and cancels pending work on unmount', () => {
    vi.useFakeTimers();
    const { Harness, register, unregister } = layout();
    const view = render(
      <Harness>
        <WebsiteWorkspace
          {...props}
          docsSlot={
            <a href="#next">
              <span tabIndex={0} ref={(node) => node?.focus()}>
                Next
              </span>
            </a>
          }
        />
      </Harness>
    );
    expect(register).not.toHaveBeenCalled();
    act(() => (document.activeElement as HTMLElement).blur());
    view.unmount();
    act(() => vi.runOnlyPendingTimers());
    expect(register).not.toHaveBeenCalled();
    expect(unregister).not.toHaveBeenCalled();
  });

  it('cancels replaced pending props and registers only the latest article', () => {
    vi.useFakeTimers();
    const { Harness, register } = layout();
    const article = (
      <a href="#next" ref={(node: HTMLAnchorElement | null) => node?.focus()}>
        Next
      </a>
    );
    const view = render(
      <Harness>
        <WebsiteWorkspace {...props} docsSlot={article} />
      </Harness>
    );
    act(() => (document.activeElement as HTMLElement).blur());
    view.rerender(
      <Harness>
        <WebsiteWorkspace
          {...props}
          routePath="/docs/latest"
          docsSlot={<article>Latest</article>}
        />
      </Harness>
    );
    act(() => vi.runOnlyPendingTimers());
    expect(register).toHaveBeenCalledTimes(1);
    expect(register.mock.calls[0][1].routePath).toBe('/docs/latest');
    expect(screen.getByText('Latest')).toBeTruthy();
  });

  it('cancels StrictMode setup and commits the focused handoff once', () => {
    vi.useFakeTimers();
    const { Harness, register } = layout();
    render(
      <StrictMode>
        <Harness>
          <WebsiteWorkspace
            {...props}
            docsSlot={
              <a href="#next" ref={(node) => node?.focus()}>
                Next
              </a>
            }
          />
        </Harness>
      </StrictMode>
    );
    expect(register).not.toHaveBeenCalled();
    act(() => (document.activeElement as HTMLElement).blur());
    act(() => vi.runOnlyPendingTimers());
    expect(register).toHaveBeenCalledTimes(1);
  });

  it('registers idle articles and later focused updates synchronously', () => {
    const { Harness, register } = layout();
    const view = render(
      <Harness>
        <WebsiteWorkspace {...props} docsSlot={<article>Initial</article>} />
      </Harness>
    );
    expect(register).toHaveBeenCalledTimes(1);
    view.rerender(
      <Harness>
        <WebsiteWorkspace
          {...props}
          docsSlot={
            <a href="#next" ref={(node) => node?.focus()}>
              Next
            </a>
          }
        />
      </Harness>
    );
    expect(register).toHaveBeenCalledTimes(2);
  });

  it('leaves standalone surface rendering synchronous', () => {
    render(
      <WebsiteWorkspace {...props} docsSlot={<article>Standalone</article>} />
    );
    expect(screen.getByText('Standalone')).toBeTruthy();
  });
});
