/** @vitest-environment jsdom */
import React, { StrictMode, createRef, useCallback, useState } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { cockpitManifest } from '@threadplane/cockpit-registry';
import { ThemeProvider } from '@threadplane/ui-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildNavigationTree } from '@threadplane/cockpit-shell';
import {
  createRuntimeSnapshot,
  parseRuntimeTarget,
} from '../runtime/runtime-state';
import type {
  CockpitControlPlaneProps,
  CockpitUtility,
} from './control-plane/cockpit-control-plane';
import type { WorkspaceHostServices } from '../workspace-contracts';
import { MobileNavOverlay } from './mobile-nav-overlay';
import { RuntimeTargetProvider } from '../runtime/runtime-target-provider';

const tree = buildNavigationTree(cockpitManifest);
const entry = cockpitManifest.find(
  (candidate) =>
    candidate.product === 'render' &&
    candidate.section === 'core-capabilities' &&
    candidate.topic === 'spec-rendering' &&
    candidate.language === 'python'
);
if (!entry) throw new Error('Expected the Spec Rendering fixture');
const snapshot = createRuntimeSnapshot(parseRuntimeTarget(null), entry.topic);

const renderOverlay = ({
  initialOpen = true,
  initialActiveUtility = null,
  onPresenceChange = vi.fn(),
  strict = false,
  variant = 'mobile',
  controlPlaneLayout = 'full',
  activeMode = 'Run',
  renderContextPane,
  onContextAction = vi.fn(),
}: {
  initialOpen?: boolean;
  initialActiveUtility?: CockpitUtility;
  onPresenceChange?: ReturnType<typeof vi.fn>;
  strict?: boolean;
  variant?: 'mobile' | 'tablet';
  controlPlaneLayout?: 'full' | 'pane';
  activeMode?: 'Docs' | 'Run' | 'Code' | 'API';
  renderContextPane?: CockpitControlPlaneProps['renderContextPane'];
  onContextAction?: ReturnType<typeof vi.fn>;
} = {}) => {
  const onClose = vi.fn();
  const onModeChange = vi.fn();
  const onFocusDestination = vi.fn();
  const onActiveUtilityChange = vi.fn();
  const navigate = vi.fn();
  const hostServices: WorkspaceHostServices = {
    resolveEntryHref: (resolvedEntry) =>
      `/workspace/${resolvedEntry.product}/${resolvedEntry.topic}/${resolvedEntry.language}`,
    navigate,
  };
  const triggerRef = createRef<HTMLButtonElement>();
  let setOpen: React.Dispatch<React.SetStateAction<boolean>> = () => undefined;
  let bumpSharedState = () => undefined;

  function Harness() {
    const [isOpen, setIsOpen] = useState(initialOpen);
    const [activeUtility, setActiveUtility] =
      useState<CockpitUtility>(initialActiveUtility);
    const [, setSharedState] = useState(0);
    setOpen = setIsOpen;
    bumpSharedState = () => setSharedState((value) => value + 1);
    const close = useCallback(() => {
      onClose();
      setIsOpen(false);
    }, []);

    return (
      <RuntimeTargetProvider>
        <ThemeProvider theme="light">
          <button ref={triggerRef}>Shell trigger</button>
          <MobileNavOverlay
            controlPlaneProps={{
              navigationTree: tree,
              manifest: cockpitManifest,
              entry,
              hostServices,
              activeMode,
              onModeChange,
              activeUtility,
              onActiveUtilityChange: (utility) => {
                onActiveUtilityChange(utility);
                setActiveUtility(utility);
              },
              activityOpenCycle: 0,
              runtimeSnapshot: snapshot,
              events: [],
              unseenProblems: 0,
              expanded: { Capability: true, Runtime: true },
              onExpandedChange: vi.fn(),
              onClearActivity: vi.fn(),
              onRecheck: vi.fn(),
              onReload: vi.fn(),
              onOpenRuntime: vi.fn(),
              onCopyDiagnostics: vi.fn(),
              renderContextPane,
            }}
            isOpen={isOpen}
            onClose={close}
            onPresenceChange={onPresenceChange}
            triggerRef={triggerRef}
            onFocusDestination={onFocusDestination}
            variant={variant}
            controlPlaneLayout={controlPlaneLayout}
            onContextAction={onContextAction}
          />
        </ThemeProvider>
      </RuntimeTargetProvider>
    );
  }

  const rendered = render(
    strict ? (
      <StrictMode>
        <Harness />
      </StrictMode>
    ) : (
      <Harness />
    )
  );
  return {
    ...rendered,
    onClose,
    onModeChange,
    onFocusDestination,
    onActiveUtilityChange,
    onPresenceChange,
    onContextAction,
    navigate,
    triggerRef,
    reopen: () => act(() => setOpen(true)),
    bumpSharedState: () => act(bumpSharedState),
  };
};

const dialog = () =>
  screen.getByRole('dialog', { name: 'Workspace control plane' });

function stubReducedMotion(matches: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: query === '(prefers-reduced-motion: reduce)' ? matches : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }))
  );
}

describe('MobileNavOverlay', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
    vi.useFakeTimers();
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
      window.setTimeout(() => callback(performance.now()), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (handle: number) =>
      window.clearTimeout(handle)
    );
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('renders nothing when initially closed without stealing focus', () => {
    const sentinel = document.createElement('button');
    document.body.appendChild(sentinel);
    sentinel.focus();

    const result = renderOverlay({ initialOpen: false });

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(sentinel);
    expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
    sentinel.remove();
  });

  it('exposes the same operational control-plane state through the adaptive drawer', () => {
    renderOverlay();
    const overlay = dialog();
    for (const mode of ['Run', 'Code', 'Docs', 'API']) {
      expect(within(overlay).getByRole('button', { name: mode })).toBeTruthy();
    }
    expect(
      within(overlay).getByRole('link', { name: 'Spec Rendering' })
    ).toBeTruthy();
    expect(
      within(overlay).getByRole('button', { name: 'Activity' })
    ).toBeTruthy();
    expect(
      within(overlay).getByRole('button', { name: 'Settings' })
    ).toBeTruthy();
    expect(
      within(overlay).getByRole('button', { name: 'Runtime' })
    ).toBeTruthy();
    expect(overlay.getAttribute('style') ?? '').not.toContain('width:');
  });

  it('renders the tablet context as a pane-only, non-mobile one-column control plane', () => {
    renderOverlay({ variant: 'tablet', controlPlaneLayout: 'pane' });
    const overlay = dialog();
    const controlPlane = overlay.querySelector(
      '[data-workspace-control-plane]'
    );

    expect(controlPlane?.getAttribute('data-mobile')).toBeNull();
    expect(
      within(overlay).queryByRole('navigation', { name: 'Workspace modes' })
    ).toBeNull();
    expect(
      within(overlay).getByRole('complementary', {
        name: 'Workspace context',
      })
    ).toBeTruthy();
  });

  it.each(['Activity', 'Settings'] as const)(
    'replaces only the drawer body for %s and restores matching utility focus',
    (utility) => {
      const result = renderOverlay();
      const overlay = dialog();
      const invoker = within(overlay).getByRole('button', { name: utility });
      fireEvent.click(invoker);

      expect(
        within(overlay).getByRole('heading', { name: utility })
      ).toBeTruthy();
      // This fixture's runtime is not_configured, so Run has no status suffix
      // and the bare name matches -- but the suffix exists in other phases, so
      // match the label prefix rather than depending on the fixture.
      expect(
        within(overlay).getByRole('button', { name: /^Run(,|$)/ })
      ).toBeTruthy();
      expect(
        within(overlay).queryByRole('button', { name: 'Capability' })
      ).toBeNull();

      fireEvent.keyDown(
        within(overlay).getByRole('heading', { name: utility }),
        { key: 'Escape' }
      );

      expect(result.onClose).not.toHaveBeenCalled();
      expect(
        within(overlay).getByRole('button', { name: 'Capability' })
      ).toBeTruthy();
      expect(document.activeElement).toBe(invoker);
    }
  );

  it.each([
    ['Activity', 'activity'],
    ['Settings', 'settings'],
  ] as const)(
    'leaves the %s panel heading focused when the utility opens the drawer',
    (heading, utility) => {
      // The tablet rail selects the utility and opens the context surface in
      // one batch, so the panel mounts in the same commit that opens the
      // dialog. The panel focuses its own heading; the drawer must not then
      // pull focus back to its first tabbable control.
      const result = renderOverlay({
        initialOpen: false,
        initialActiveUtility: utility,
        variant: 'tablet',
        controlPlaneLayout: 'pane',
      });

      result.reopen();

      expect(document.activeElement).toBe(
        within(dialog()).getByRole('heading', { name: heading })
      );
    }
  );

  it('still claims drawer focus when no panel claims it first', () => {
    const result = renderOverlay({ initialOpen: false });

    result.reopen();

    // Which control wins is the document-order first tabbable, and jsdom
    // groups a selector list by selector instead of document order -- so
    // assert the drawer took focus rather than naming the element.
    expect(document.activeElement).not.toBe(document.body);
    expect(dialog().contains(document.activeElement)).toBe(true);
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'drawer close',
      () =>
        fireEvent.click(
          within(dialog()).getByRole('button', { name: 'Close navigation' })
        ),
    ],
    ['backdrop', () => fireEvent.mouseDown(dialog())],
  ] as const)(
    'keeps focus in the closing drawer and restores the trigger exactly once after 150ms for %s',
    (_closePath, close) => {
      const result = renderOverlay();
      const trigger = result.triggerRef.current;
      if (!trigger) throw new Error('Expected the shell trigger');
      const focus = vi.spyOn(trigger, 'focus');

      close();

      expect(result.onClose).toHaveBeenCalledTimes(1);
      expect(dialog().getAttribute('data-state')).toBe('closing');
      expect(focus).not.toHaveBeenCalled();
      expect(result.onPresenceChange).toHaveBeenLastCalledWith(true);

      act(() => vi.advanceTimersByTime(149));
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(focus).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(1));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
      expect(focus).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(15));
      expect(focus).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(focus).toHaveBeenCalledTimes(1);

      act(() => vi.advanceTimersByTime(300));
      expect(focus).toHaveBeenCalledTimes(1);
    }
  );

  it('focuses the selected destination panel after the drawer closes', () => {
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Code' }));
    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));

    expect(focus).not.toHaveBeenCalled();
    expect(result.onFocusDestination).toHaveBeenCalledTimes(1);
    expect(result.onFocusDestination).toHaveBeenCalledWith('Code');
  });

  it('completes host context actions only after the drawer has closed', () => {
    const result = renderOverlay({
      activeMode: 'Docs',
      renderContextPane: ({ onAction }) => (
        <button type="button" onClick={() => onAction?.('search-docs')}>
          Search docs
        </button>
      ),
    });
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.click(
      within(dialog()).getByRole('button', { name: 'Search docs' })
    );

    expect(dialog().getAttribute('data-state')).toBe('closing');
    expect(result.onContextAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.onContextAction).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(16));
    expect(focus).toHaveBeenCalledOnce();
    expect(result.onContextAction).toHaveBeenCalledOnce();
    expect(result.onContextAction).toHaveBeenCalledWith('search-docs');
  });

  it.each([
    ['Escape', () => fireEvent.keyDown(document, { key: 'Escape' })],
    [
      'drawer close',
      () =>
        fireEvent.click(
          within(dialog()).getByRole('button', { name: 'Close navigation' })
        ),
    ],
  ] as const)(
    'closes, releases presence, and restores focus synchronously with reduced motion for %s',
    (_closePath, close) => {
      stubReducedMotion(true);
      const result = renderOverlay();
      const trigger = result.triggerRef.current;
      if (!trigger) throw new Error('Expected the shell trigger');
      const focus = vi.spyOn(trigger, 'focus');

      close();

      expect(result.onClose).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
      expect(focus).toHaveBeenCalledTimes(1);
    }
  );

  it('waits for the shell to release inert before restoring reduced-motion focus', () => {
    stubReducedMotion(true);
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    trigger.setAttribute('inert', '');
    const focus = vi.spyOn(trigger, 'focus');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(focus).not.toHaveBeenCalled();
    trigger.removeAttribute('inert');
    act(() => vi.advanceTimersByTime(16));
    expect(focus).toHaveBeenCalledOnce();
  });

  it('completes destination-panel navigation synchronously with reduced motion', () => {
    stubReducedMotion(true);
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    expect(
      fireEvent.click(
        within(dialog()).getByRole('link', { name: 'Spec Rendering' })
      )
    ).toBe(false);

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
    expect(focus).not.toHaveBeenCalled();
    expect(result.navigate).toHaveBeenCalledTimes(1);
    expect(result.navigate).toHaveBeenCalledWith({
      path: '/workspace/render/spec-rendering/python',
      restoreFocus: 'workspace-panel',
    });
  });

  it('finishes an in-flight close when reduced motion activates and removes its listener', () => {
    const listeners = new Set<() => void>();
    const reducedMotion = {
      matches: false,
      media: '(prefers-reduced-motion: reduce)',
      onchange: null,
      addEventListener: (_type: string, listener: () => void) =>
        listeners.add(listener),
      removeEventListener: (_type: string, listener: () => void) =>
        listeners.delete(listener),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    };
    vi.stubGlobal(
      'matchMedia',
      vi.fn((query: string) =>
        query === reducedMotion.media
          ? reducedMotion
          : {
              ...reducedMotion,
              media: query,
              addEventListener: vi.fn(),
              removeEventListener: vi.fn(),
            }
      )
    );
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(dialog().getAttribute('data-state')).toBe('closing');

    reducedMotion.matches = true;
    act(() => listeners.forEach((listener) => listener()));

    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
    expect(focus).toHaveBeenCalledTimes(1);

    result.unmount();
    expect(listeners.size).toBe(0);
  });

  it('defers capability routing until the drawer has closed with destination-panel intent', () => {
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');
    const link = within(dialog()).getByRole('link', { name: 'Spec Rendering' });

    expect(fireEvent.click(link)).toBe(false);
    expect(result.onClose).toHaveBeenCalledTimes(1);
    expect(result.navigate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(150));
    expect(result.navigate).not.toHaveBeenCalled();
    expect(focus).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(16));
    expect(focus).not.toHaveBeenCalled();
    expect(result.navigate).toHaveBeenCalledTimes(1);
    expect(result.navigate).toHaveBeenCalledWith({
      path: '/workspace/render/spec-rendering/python',
      restoreFocus: 'workspace-panel',
    });
  });

  it('focuses the active panel instead of routing when the selected link is already current', () => {
    window.history.replaceState(
      {},
      '',
      '/workspace/render/spec-rendering/python'
    );
    const result = renderOverlay();
    const link = within(dialog()).getByRole('link', {
      name: 'Spec Rendering',
    });

    expect(fireEvent.click(link)).toBe(false);
    expect(result.onClose).toHaveBeenCalledTimes(1);
    expect(result.navigate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));

    expect(result.navigate).not.toHaveBeenCalled();
    expect(result.onFocusDestination).toHaveBeenCalledOnce();
    expect(result.onFocusDestination).toHaveBeenCalledWith('Run');
  });

  it('defers the host-resolved language destination until the drawer has closed', () => {
    const result = renderOverlay();
    const overlay = dialog();

    fireEvent.click(within(overlay).getByRole('button', { name: 'Settings' }));
    fireEvent.click(within(overlay).getByRole('button', { name: 'Python' }));
    const languageLink = within(overlay).getByRole('menuitem', {
      name: 'TypeScript',
    });
    expect(languageLink.getAttribute('href')).toBe(
      '/workspace/render/overview/python'
    );

    expect(fireEvent.click(languageLink)).toBe(false);
    expect(result.onClose).toHaveBeenCalledTimes(1);
    expect(result.navigate).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));

    expect(result.navigate).toHaveBeenCalledWith({
      path: '/workspace/render/overview/python',
      restoreFocus: 'workspace-panel',
    });
  });

  it('cancels a pending capability route when a later modified anchor click is not deferred', () => {
    const result = renderOverlay();
    const overlay = dialog();

    expect(
      fireEvent.click(
        within(overlay).getByRole('link', { name: 'Persistence' })
      )
    ).toBe(false);
    expect(
      fireEvent.click(
        within(overlay).getByRole('link', { name: 'Spec Rendering' }),
        { ctrlKey: true }
      )
    ).toBe(true);

    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));
    expect(result.navigate).not.toHaveBeenCalled();
  });

  it('cancels a pending capability route for a later non-capability target link', () => {
    const result = renderOverlay();
    const overlay = dialog();
    const nativeLink = document.createElement('a');
    nativeLink.href = '/native-destination';
    nativeLink.target = '_blank';
    nativeLink.textContent = 'Native destination';
    overlay.appendChild(nativeLink);

    expect(
      fireEvent.click(
        within(overlay).getByRole('link', { name: 'Persistence' })
      )
    ).toBe(false);
    expect(fireEvent.click(nativeLink)).toBe(true);

    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));
    expect(result.navigate).not.toHaveBeenCalled();
  });

  it('replaces a pending capability route with the latest eligible link', () => {
    const result = renderOverlay();
    const overlay = dialog();

    expect(
      fireEvent.click(
        within(overlay).getByRole('link', { name: 'Persistence' })
      )
    ).toBe(false);
    expect(
      fireEvent.click(
        within(overlay).getByRole('link', { name: 'Spec Rendering' })
      )
    ).toBe(false);

    act(() => vi.advanceTimersByTime(150));
    act(() => vi.advanceTimersByTime(16));
    expect(result.navigate).toHaveBeenCalledTimes(1);
    expect(result.navigate).toHaveBeenCalledWith({
      path: '/workspace/render/spec-rendering/python',
      restoreFocus: 'workspace-panel',
    });
  });

  it('cancels closing focus and capability routing when reopened', () => {
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');
    fireEvent.click(
      within(dialog()).getByRole('link', { name: 'Spec Rendering' })
    );
    act(() => vi.advanceTimersByTime(100));

    result.reopen();
    act(() => vi.advanceTimersByTime(500));

    expect(dialog().getAttribute('data-state')).toBe('open');
    expect(focus).not.toHaveBeenCalled();
    expect(result.navigate).not.toHaveBeenCalled();
    expect(result.onPresenceChange).not.toHaveBeenCalledWith(false);
  });

  it('cancels a scheduled requested focus restoration when unmounted', () => {
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.keyDown(document, { key: 'Escape' });
    act(() => vi.advanceTimersByTime(150));
    result.unmount();
    act(() => vi.advanceTimersByTime(16));

    expect(focus).not.toHaveBeenCalled();
  });

  it('clears the hidden mobile modal immediately at the desktop breakpoint without restoring focus', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        media: '(min-width: 48rem)',
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void
        ) => listeners.add(listener),
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void
        ) => listeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
    );
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    act(() => {
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });

    expect(result.onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(result.onPresenceChange).toHaveBeenLastCalledWith(false);
    expect(focus).not.toHaveBeenCalled();
  });

  it('cancels queued focus and capability routing when the breakpoint changes after close', () => {
    const listeners = new Set<(event: MediaQueryListEvent) => void>();
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({
        matches: false,
        media: '(min-width: 48rem)',
        onchange: null,
        addEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void
        ) => listeners.add(listener),
        removeEventListener: (
          _type: string,
          listener: (event: MediaQueryListEvent) => void
        ) => listeners.delete(listener),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })
    );
    const result = renderOverlay();
    const trigger = result.triggerRef.current;
    if (!trigger) throw new Error('Expected the shell trigger');
    const focus = vi.spyOn(trigger, 'focus');

    fireEvent.click(
      within(dialog()).getByRole('link', { name: 'Spec Rendering' })
    );
    act(() => vi.advanceTimersByTime(150));
    act(() => {
      for (const listener of listeners) {
        listener({ matches: true } as MediaQueryListEvent);
      }
    });
    act(() => vi.advanceTimersByTime(16));

    expect(focus).not.toHaveBeenCalled();
    expect(result.navigate).not.toHaveBeenCalled();
  });

  it('does not reset dialog focus when shared state rerenders', () => {
    const result = renderOverlay();
    const capability = within(dialog()).getByRole('button', {
      name: 'Capability',
    });
    capability.focus();

    result.bumpSharedState();

    expect(document.activeElement).toBe(capability);
  });

  it('clears reported presence when an open overlay unmounts', () => {
    const result = renderOverlay();
    expect(result.onPresenceChange).toHaveBeenLastCalledWith(true);
    result.onPresenceChange.mockClear();

    result.unmount();

    expect(result.onPresenceChange).toHaveBeenCalledTimes(1);
    expect(result.onPresenceChange).toHaveBeenCalledWith(false);
  });

  it('settles on present in StrictMode for an initially open overlay', () => {
    const onPresenceChange = vi.fn();
    renderOverlay({ onPresenceChange, strict: true });

    expect(dialog().getAttribute('data-state')).toBe('open');
    expect(onPresenceChange).toHaveBeenLastCalledWith(true);
  });

  it('uses stable target hooks and explicit coarse-pointer and reduced-motion rules', () => {
    renderOverlay();
    expect(
      within(dialog()).getByRole('button', { name: 'Close navigation' })
        .classList
    ).toContain('workspace-mobile-control-plane-close');

    const workspaceRoot = process.cwd().endsWith('/libs/workspace-react')
      ? resolve(process.cwd(), '../..')
      : process.cwd().endsWith('/apps/cockpit')
      ? resolve(process.cwd(), '../..')
      : process.cwd();
    const css = readFileSync(
      resolve(workspaceRoot, 'libs/workspace-react/src/styles/workspace.css'),
      'utf8'
    );
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.workspace-mobile-navigation-trigger[\s\S]*\.workspace-mobile-control-plane-close/
    );
    expect(css).toMatch(
      /\.workspace-mobile-navigation-trigger[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/
    );
    expect(css).toMatch(
      /\.workspace-mobile-navigation-trigger\s*\{[^}]*flex:\s*none;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/
    );
    expect(css).toMatch(
      /\.workspace-mobile-control-plane-close[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/
    );
    expect(css).toContain('.workspace-mobile-navigation-trigger:focus-visible');
    expect(css).toContain('.workspace-tablet-context-trigger:focus-visible');
    expect(css).toMatch(
      /\.workspace-mobile-control-plane\s*\{[^}]*position:\s*fixed;[^}]*z-index:\s*50;/
    );
    expect(css).toMatch(
      /\.workspace-mobile-control-plane\[data-variant=["']mobile["']\]\s*\{[^}]*inset:\s*0;/
    );
    expect(css).toMatch(
      /@media \(forced-colors: active\)[\s\S]*\.workspace-tablet-context-trigger[\s\S]*border:\s*1px solid CanvasText/
    );
    expect(css).toMatch(
      /@media \(pointer: coarse\)[\s\S]*\.workspace-tablet-context-trigger[\s\S]*min-width:\s*44px[\s\S]*min-height:\s*44px/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workspace-mobile-control-plane[\s\S]*transition:\s*none\s*!important/
    );
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.workspace-runtime-status-loader[\s\S]*animation:\s*none\s*!important/
    );
  });
});
