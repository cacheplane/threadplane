/**
 * Session-storage handoff between the docs workspace surface, which records
 * where focus should land after a navigation, and the root shell, which
 * restores it once the destination has rendered. It lives in its own module so
 * the root shell can read it without importing the surface (see
 * WebsiteWorkspaceRoot.tsx for why that import must not exist).
 */
export const WORKSPACE_PANEL_FOCUS_INTENT =
  'threadplane:website:workspace-panel-focus';
export const WORKSPACE_PANEL_FOCUS_MAX_AGE_MS = 10_000;
