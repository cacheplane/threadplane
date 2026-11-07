/** Framework articles share a reading layout without theming SDK runtimes. */
export function isFrameworkDocsRoute(path: string | null | undefined): boolean {
  return /^\/docs\/(angular|react)\//.test(path ?? '');
}
