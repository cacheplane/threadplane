/** Framework articles omit their redundant framework and article breadcrumbs. */
export function isFrameworkDocsRoute(path: string | null | undefined): boolean {
  return /^\/docs\/(angular|react)\//.test(path ?? '');
}

/** The docs theme also covers the landing page, shared guides, and API reference. */
export function isDocsReadingRoute(path: string | null | undefined): boolean {
  return /^\/docs(?:\/|$)/.test(path ?? '');
}
