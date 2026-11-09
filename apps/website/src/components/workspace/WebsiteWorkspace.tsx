'use client';

import { useContext, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { deferDocsLinkHandoff, hasBusyDocsLink } from './docs-link-handoff';
import {
  captureDocsDisclosures,
  DocsDisclosureHandoff,
  type DocsDisclosureSnapshot,
} from './DocsDisclosureHandoff';
import { WebsiteWorkspaceLayoutContext } from './WebsiteWorkspaceRoot';
import {
  WebsiteWorkspaceSurface,
  type WebsiteWorkspaceProps,
} from './WebsiteWorkspaceSurface';

/*
 * The docs-route registrar. Imported by docs pages only, so the static import
 * of the surface above is what keeps the capability catalog in docs bundles and
 * out of the root layout's. It hands the surface to the root shell through
 * `register` rather than the shell importing it.
 */

export function WebsiteWorkspace(props: WebsiteWorkspaceProps) {
  const layout = useContext(WebsiteWorkspaceLayoutContext);
  const tokenRef = useRef<object | null>(null);
  if (!tokenRef.current) tokenRef.current = {};
  const token = tokenRef.current;
  const fallbackRef = useRef<HTMLDivElement>(null);
  const didRegisterRef = useRef(false);
  const disclosureHandoffRef = useRef<{
    routePath: string;
    snapshot: DocsDisclosureSnapshot;
  } | null>(null);

  useLayoutEffect(() => {
    if (!layout) return undefined;
    let current = true;
    let registered = false;
    const register = () => {
      if (!current) return;
      if (!didRegisterRef.current && host) {
        const snapshot = captureDocsDisclosures(host);
        if (snapshot)
          disclosureHandoffRef.current = {
            routePath: props.routePath,
            snapshot,
          };
      }
      const handoff = disclosureHandoffRef.current;
      const registration =
        handoff?.routePath === props.routePath
          ? {
              ...props,
              docsSlot: (
                <DocsDisclosureHandoff snapshot={handoff.snapshot}>
                  {props.docsSlot}
                </DocsDisclosureHandoff>
              ),
            }
          : props;
      didRegisterRef.current = true;
      registered = true;
      layout.register(token, registration, WebsiteWorkspaceSurface);
    };
    const host = fallbackRef.current;
    let cancel: (() => void) | undefined;
    if (!didRegisterRef.current && host && hasBusyDocsLink(host)) {
      cancel = deferDocsLinkHandoff(host, () => {
        // This task runs outside React's lifecycle. Commit before another input
        // can start against the article that is about to be replaced.
        if (current && host.isConnected && !hasBusyDocsLink(host))
          flushSync(register);
      });
    } else {
      register();
    }
    return () => {
      current = false;
      cancel?.();
      if (registered) layout.unregister(token);
    };
  }, [
    layout?.register,
    layout?.unregister,
    token,
    props.resolution,
    props.presentation,
    props.contentBundle,
    props.navigationTree,
    props.routePath,
    props.requestedMode,
    props.docsSlot,
    props.runFallbackSlot,
    props.apiSlot,
    props.defaultMode,
    props.framework,
    props.docsContext,
    props.contextTrail,
  ]);

  if (!layout) return <WebsiteWorkspaceSurface {...props} />;
  if (layout.activeToken === token) return null;

  // Preserve the server-rendered article until the persistent shell registers.
  return (
    <div ref={fallbackRef} className="website-workspace-fallback">
      {props.docsSlot ?? null}
    </div>
  );
}
