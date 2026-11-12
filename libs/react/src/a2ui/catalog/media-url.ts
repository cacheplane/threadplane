/**
 * A media URL the catalog will load: relative, http(s), blob, or a data URL of
 * the element's own kind. Anything else, including script schemes, is dropped.
 */
export function mediaUrl(
  value: unknown,
  kind: 'image' | 'audio' | 'video'
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (url === '') return undefined;
  // Browsers ignore tabs and newlines inside a scheme, so strip them before reading it.
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url.replace(/[\t\n\r]/g, ''));
  if (scheme === null) return url;
  const name = scheme[1].toLowerCase();
  if (name === 'http' || name === 'https' || name === 'blob') return url;
  return name === 'data' && url.slice(5, 6 + kind.length).toLowerCase() === `${kind}/`
    ? url
    : undefined;
}
