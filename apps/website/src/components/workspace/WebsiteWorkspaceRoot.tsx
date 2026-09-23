'use client';

import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
} from 'react';
import { RuntimeTargetProvider } from '@threadplane/workspace-react';
import { usePathname } from 'next/navigation';
import type { WebsiteWorkspaceProps } from './WebsiteWorkspaceSurface';
import {
  WORKSPACE_PANEL_FOCUS_INTENT,
  WORKSPACE_PANEL_FOCUS_MAX_AGE_MS,
} from './workspace-panel-focus';

/*
 * The persistent docs-workspace shell, mounted around every page by
 * app/layout.tsx.
 *
 * This module must NOT import WebsiteWorkspaceSurface (only the type above,
 * which is erased). The surface reaches @threadplane/cockpit-registry — the
 * whole capability catalog — and anything imported here ships to every route,
 * the homepage included, where it competed with the LCP image on a phone. Docs
 * routes pass the surface in through `register` instead, so it is bundled only
 * where it renders. e2e/home-bundle.spec.ts fails if the catalog reaches `/`.
 */

interface WebsiteWorkspaceRegistration {
  readonly token: object;
  readonly props: WebsiteWorkspaceProps;
  /** Supplied by the registrar, so this module never imports it. */
  readonly Surface: ComponentType<WebsiteWorkspaceProps>;
}

interface WebsiteWorkspaceLayoutContextValue {
  readonly activeToken: object | null;
  readonly register: (
    token: object,
    props: WebsiteWorkspaceProps,
    Surface: ComponentType<WebsiteWorkspaceProps>
  ) => void;
  readonly unregister: (token: object) => void;
}

export const WebsiteWorkspaceLayoutContext =
  createContext<WebsiteWorkspaceLayoutContextValue | null>(null);

export function WebsiteWorkspaceLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  const pathname = usePathname();
  const activeRef = useRef<WebsiteWorkspaceRegistration | null>(null);
  const [active, setActive] = useState<WebsiteWorkspaceRegistration | null>(
    null
  );

  const register = useCallback(
    (
      token: object,
      props: WebsiteWorkspaceProps,
      Surface: ComponentType<WebsiteWorkspaceProps>
    ) => {
      const registration = { token, props, Surface };
      activeRef.current = registration;
      setActive(registration);
    },
    []
  );
  const unregister = useCallback((token: object) => {
    if (activeRef.current?.token !== token) return;
    activeRef.current = null;
    setActive(null);
  }, []);

  useEffect(() => {
    let rawIntent: string | null = null;
    try {
      rawIntent = window.sessionStorage.getItem(WORKSPACE_PANEL_FOCUS_INTENT);
    } catch {
      return undefined;
    }
    if (!rawIntent) return undefined;

    let intent: { destination?: unknown; requestedAt?: unknown };
    try {
      intent = JSON.parse(rawIntent) as typeof intent;
    } catch {
      window.sessionStorage.removeItem(WORKSPACE_PANEL_FOCUS_INTENT);
      return undefined;
    }

    const currentDestination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    const isFresh =
      typeof intent.requestedAt === 'number' &&
      Date.now() - intent.requestedAt <= WORKSPACE_PANEL_FOCUS_MAX_AGE_MS;
    if (!isFresh) {
      window.sessionStorage.removeItem(WORKSPACE_PANEL_FOCUS_INTENT);
      return undefined;
    }
    if (intent.destination !== currentDestination) return undefined;

    const focusDestination = () => {
      const panel = Array.from(
        document.querySelectorAll<HTMLElement>('[data-workspace-panel-target]')
      ).find(
        (candidate) =>
          !candidate.closest('[aria-hidden="true"]') &&
          !candidate.closest('[inert]')
      );
      const target = panel ?? document.querySelector<HTMLElement>('main h1');
      if (!target) return;
      if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
      target.focus();
      if (document.activeElement === target) {
        try {
          window.sessionStorage.removeItem(WORKSPACE_PANEL_FOCUS_INTENT);
        } catch {
          // Focus restoration succeeded even when storage becomes unavailable.
        }
      }
    };
    const timer = window.setTimeout(focusDestination, 250);
    return () => window.clearTimeout(timer);
  }, [active, pathname]);

  return (
    <WebsiteWorkspaceLayoutContext.Provider
      value={{ activeToken: active?.token ?? null, register, unregister }}
    >
      {active ? <active.Surface {...active.props} /> : null}
      {children}
    </WebsiteWorkspaceLayoutContext.Provider>
  );
}

export function WebsiteWorkspaceRoot({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <RuntimeTargetProvider>
      <WebsiteWorkspaceLayout>{children}</WebsiteWorkspaceLayout>
    </RuntimeTargetProvider>
  );
}
