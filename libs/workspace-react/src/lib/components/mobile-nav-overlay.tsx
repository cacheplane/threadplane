'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { ControlPlaneMode } from '@threadplane/ui-react';
import { X } from 'lucide-react';
import {
  CockpitControlPlane,
  type CockpitControlPlaneProps,
} from './control-plane/cockpit-control-plane';
import { toSameOriginNavigationPath } from '../workspace-navigation';

export interface MobileNavOverlayProps {
  controlPlaneProps: Omit<
    CockpitControlPlaneProps,
    'mobile' | 'onModeSelected' | 'onNavigate'
  >;
  isOpen: boolean;
  onClose: () => void;
  onPresenceChange?: (present: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
  dialogLabel?: string;
  title?: string;
  variant?: 'mobile' | 'tablet';
  controlPlaneLayout?: 'full' | 'pane';
  onFocusDestination?: (mode: ControlPlaneMode) => void;
  onUtilityDismissed?: CockpitControlPlaneProps['onUtilityDismissed'];
  onContextAction?: (action: string) => void;
}

export function MobileNavOverlay({
  controlPlaneProps,
  isOpen,
  onClose,
  onPresenceChange,
  triggerRef,
  dialogLabel = 'Workspace control plane',
  title = 'Workspace',
  variant = 'mobile',
  controlPlaneLayout = 'full',
  onFocusDestination,
  onUtilityDismissed,
  onContextAction,
}: MobileNavOverlayProps) {
  const [state, setState] = useState<'closed' | 'open' | 'closing'>(
    isOpen ? 'open' : 'closed'
  );
  const dialogRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef(state);
  const onCloseRef = useRef(onClose);
  const onPresenceChangeRef = useRef(onPresenceChange);
  const hostServicesRef = useRef(controlPlaneProps.hostServices);
  const triggerRefRef = useRef(triggerRef);
  const closeIntentRef = useRef<
    | { kind: 'none' }
    | { kind: 'trigger' }
    | { kind: 'panel'; mode: ControlPlaneMode }
    | { kind: 'navigation' }
    | { kind: 'action'; action: string }
  >({ kind: 'none' });
  const pendingNavigationRef = useRef<string | null>(null);
  const prefersReducedMotionRef = useRef(false);
  const cancelScheduledFocusRef = useRef<(() => void) | null>(null);
  const reportedPresenceRef = useRef<boolean | undefined>(undefined);
  stateRef.current = state;
  onCloseRef.current = onClose;
  onPresenceChangeRef.current = onPresenceChange;
  hostServicesRef.current = controlPlaneProps.hostServices;
  triggerRefRef.current = triggerRef;

  const cancelScheduledFocus = useCallback(() => {
    cancelScheduledFocusRef.current?.();
    cancelScheduledFocusRef.current = null;
  }, []);

  const completePostClose = useCallback(() => {
    cancelScheduledFocus();
    if (stateRef.current !== 'closed') return;
    const intent = closeIntentRef.current;
    if (intent.kind === 'none') return;
    closeIntentRef.current = { kind: 'none' };
    const destination = pendingNavigationRef.current;
    pendingNavigationRef.current = null;
    if (intent.kind === 'trigger') {
      triggerRefRef.current?.current?.focus();
    } else if (intent.kind === 'panel') {
      onFocusDestination?.(intent.mode);
    } else if (intent.kind === 'navigation' && destination) {
      hostServicesRef.current.navigate({
        path: destination,
        restoreFocus: 'workspace-panel',
      });
    } else if (intent.kind === 'action') {
      triggerRefRef.current?.current?.focus();
      onContextAction?.(intent.action);
    }
  }, [cancelScheduledFocus, onContextAction, onFocusDestination]);

  const requestClose = useCallback(
    (intent: 'trigger' | 'navigation' = 'trigger') => {
      if (stateRef.current !== 'open') return;
      if (
        !(intent === 'navigation' && closeIntentRef.current.kind === 'panel')
      ) {
        closeIntentRef.current = { kind: intent };
      }
      const nextState = prefersReducedMotionRef.current ? 'closed' : 'closing';
      stateRef.current = nextState;
      setState(nextState);
      onCloseRef.current();
    },
    []
  );

  const requestContextAction = useCallback((action: string) => {
    if (stateRef.current !== 'open') return;
    closeIntentRef.current = { kind: 'action', action };
    const nextState = prefersReducedMotionRef.current ? 'closed' : 'closing';
    stateRef.current = nextState;
    setState(nextState);
    onCloseRef.current();
  }, []);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const applyPreference = ({ matches }: Pick<MediaQueryList, 'matches'>) => {
      prefersReducedMotionRef.current = matches;
      if (!matches) return;
      cancelScheduledFocus();
      if (stateRef.current === 'closing') {
        stateRef.current = 'closed';
        setState('closed');
      } else if (stateRef.current === 'closed') {
        completePostClose();
      }
    };
    const handleChange = () => applyPreference(reducedMotion);

    if (typeof reducedMotion.addEventListener === 'function') {
      reducedMotion.addEventListener('change', handleChange);
    } else {
      reducedMotion.addListener(handleChange);
    }
    applyPreference(reducedMotion);
    return () => {
      if (typeof reducedMotion.removeEventListener === 'function') {
        reducedMotion.removeEventListener('change', handleChange);
      } else {
        reducedMotion.removeListener(handleChange);
      }
    };
  }, [cancelScheduledFocus, completePostClose]);

  useEffect(() => {
    if (isOpen) {
      if (stateRef.current !== 'open') {
        closeIntentRef.current = { kind: 'none' };
        pendingNavigationRef.current = null;
        cancelScheduledFocus();
      }
      setState((current) => (current === 'open' ? current : 'open'));
      return;
    }
    if (stateRef.current !== 'open') return;
    const nextState = prefersReducedMotionRef.current ? 'closed' : 'closing';
    stateRef.current = nextState;
    setState(nextState);
  }, [cancelScheduledFocus, isOpen]);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const exitQueries =
      variant === 'mobile'
        ? [window.matchMedia('(min-width: 48rem)')]
        : [
            window.matchMedia('(max-width: 47.999rem)'),
            window.matchMedia('(min-width: 64rem)'),
          ];
    const closeOutsideVariant = ({
      matches,
    }: Pick<MediaQueryList, 'matches'>) => {
      if (!matches) return;
      closeIntentRef.current = { kind: 'none' };
      pendingNavigationRef.current = null;
      cancelScheduledFocus();
      if (stateRef.current === 'closed') return;
      stateRef.current = 'closed';
      setState('closed');
      onCloseRef.current();
    };
    const handleChange = (event: MediaQueryListEvent) =>
      closeOutsideVariant(event);
    for (const query of exitQueries) {
      query.addEventListener('change', handleChange);
      closeOutsideVariant(query);
    }
    return () => {
      for (const query of exitQueries) {
        query.removeEventListener('change', handleChange);
      }
    };
  }, [cancelScheduledFocus, variant]);

  useEffect(() => {
    if (state !== 'closing') return;
    if (prefersReducedMotionRef.current) {
      stateRef.current = 'closed';
      setState('closed');
      return;
    }
    const timer = setTimeout(() => {
      stateRef.current = 'closed';
      setState('closed');
    }, 150);
    return () => clearTimeout(timer);
  }, [state]);

  const present = state !== 'closed';
  useLayoutEffect(() => {
    if (reportedPresenceRef.current === present) return;
    reportedPresenceRef.current = present;
    onPresenceChangeRef.current?.(present);
  }, [present]);

  useEffect(
    () => () => {
      if (reportedPresenceRef.current === false) return;
      reportedPresenceRef.current = false;
      onPresenceChangeRef.current?.(false);
    },
    []
  );

  useEffect(() => {
    if (state !== 'closed' || closeIntentRef.current.kind === 'none') {
      return undefined;
    }
    if (prefersReducedMotionRef.current) {
      completePostClose();
      return undefined;
    }
    const restoreFocusAndNavigate = () => {
      cancelScheduledFocusRef.current = null;
      completePostClose();
    };

    if (typeof window.requestAnimationFrame === 'function') {
      const frame = window.requestAnimationFrame(restoreFocusAndNavigate);
      cancelScheduledFocusRef.current = () =>
        window.cancelAnimationFrame(frame);
    } else {
      const timer = window.setTimeout(restoreFocusAndNavigate, 0);
      cancelScheduledFocusRef.current = () => window.clearTimeout(timer);
    }

    return cancelScheduledFocus;
  }, [cancelScheduledFocus, completePostClose, state]);

  const interceptWorkspaceNavigation = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>('a')
          : null;
      if (!anchor) return;

      const shouldDefer =
        anchor.hasAttribute('data-workspace-navigation-link') &&
        !event.defaultPrevented &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey &&
        !anchor.target &&
        !anchor.hasAttribute('download');
      if (!shouldDefer) {
        pendingNavigationRef.current = null;
        return;
      }

      const destination = toSameOriginNavigationPath(anchor.href);
      if (!destination) {
        pendingNavigationRef.current = null;
        return;
      }
      const currentDestination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (destination === currentDestination) {
        pendingNavigationRef.current = null;
        closeIntentRef.current = {
          kind: 'panel',
          mode: controlPlaneProps.activeMode,
        };
        event.preventDefault();
        return;
      }
      pendingNavigationRef.current = destination;
      closeIntentRef.current = { kind: 'navigation' };
      event.preventDefault();
    },
    [controlPlaneProps.activeMode]
  );

  useEffect(() => {
    if (!present) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [present]);

  useEffect(() => {
    if (state !== 'open') return undefined;
    const dialog = dialogRef.current;
    const focusable = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'a[href]:not([tabindex="-1"]), button:not(:disabled):not([tabindex="-1"]), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      );
    // A utility panel mounting in the same commit that opens the drawer
    // focuses its own heading first, and child effects run before this one.
    // Claiming the first tabbable control unconditionally would undo that.
    if (!dialog?.contains(document.activeElement)) focusable()[0]?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        requestClose('trigger');
        return;
      }
      if (variant === 'tablet') return;
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      // Keep the modal traversal deterministic when Safari skips links in its
      // native Tab order. Menu items with tabIndex=-1 retain arrow navigation.
      const current = items.indexOf(document.activeElement as HTMLElement);
      const next = event.shiftKey
        ? (current <= 0 ? items.length - 1 : current - 1)
        : (current + 1) % items.length;
      event.preventDefault();
      items[next].focus();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [requestClose, state, variant]);

  if (state === 'closed') return null;

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={variant === 'mobile' ? true : undefined}
      aria-label={dialogLabel}
      data-state={state}
      data-variant={variant}
      className={
        variant === 'tablet'
          ? 'workspace-mobile-control-plane workspace-tablet-context-surface fixed z-50'
          : 'workspace-mobile-control-plane fixed inset-0 z-50'
      }
      onClickCapture={interceptWorkspaceNavigation}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose('trigger');
      }}
    >
      <div className="workspace-mobile-control-plane-panel">
        <header className="workspace-mobile-control-plane-header">
          <span>{title}</span>
          <button
            type="button"
            onClick={() => requestClose('trigger')}
            aria-label="Close navigation"
            className="workspace-mobile-control-plane-close"
          >
            <X size={20} strokeWidth={2} aria-hidden="true" />
          </button>
        </header>
        <CockpitControlPlane
          {...controlPlaneProps}
          mobile={variant === 'mobile'}
          layout={controlPlaneLayout}
          onContextAction={requestContextAction}
          onModeSelected={(mode) => {
            closeIntentRef.current = { kind: 'panel', mode };
            if (stateRef.current !== 'open') return;
            const nextState = prefersReducedMotionRef.current
              ? 'closed'
              : 'closing';
            stateRef.current = nextState;
            setState(nextState);
            onCloseRef.current();
          }}
          onNavigate={() => requestClose('navigation')}
          onUtilityDismissed={onUtilityDismissed}
        />
      </div>
    </div>
  );
}
