import {
  getCanonicalWebsiteWorkspaceHref,
  resolveDocsWorkspace,
} from '@threadplane/cockpit-registry';

/**
 * The example the index's Run rail item opens, resolved through the
 * registry. `resolveDocsWorkspace` never returns null; a renamed or removed
 * capability resolves as docs-only, so the href is derived only from a
 * mapped resolution and Run falls back to disabled rather than to a dead
 * link.
 */
export const DEFAULT_EXAMPLE_RESOLUTION = resolveDocsWorkspace(
  '/docs/angular/langgraph/guides/streaming',
  'Streaming'
);

export const DEFAULT_EXAMPLE_RUN_HREF =
  DEFAULT_EXAMPLE_RESOLUTION.kind === 'mapped'
    ? getCanonicalWebsiteWorkspaceHref(DEFAULT_EXAMPLE_RESOLUTION, 'Run')
    : undefined;
