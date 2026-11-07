/** Narrative and generated reference pages share presentation, never embedded SDK runtimes. */
export function isDocsReadingRoute(path: string | null | undefined): boolean {
  return /^\/docs\/(?:(?:angular|react|shared)\/|api(?:\/|$))/.test(path ?? '');
}
