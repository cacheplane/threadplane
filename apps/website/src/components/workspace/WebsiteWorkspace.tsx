'use client';

import { useContext, useLayoutEffect, useRef } from 'react';
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

  useLayoutEffect(() => {
    if (!layout) return undefined;
    layout.register(token, props, WebsiteWorkspaceSurface);
    return () => layout.unregister(token);
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
    props.docsContext,
    props.contextTrail,
  ]);

  if (!layout) return <WebsiteWorkspaceSurface {...props} />;
  if (layout.activeToken === token) return null;

  // Preserve the server-rendered article until the persistent shell registers.
  return props.docsSlot ?? null;
}
