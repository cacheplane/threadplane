/** Classify a Markdown destination without rewriting the supplied value. */
export function markdownUrl(
  value: string,
  kind: 'link' | 'image'
): string | undefined {
  if (!value.trim()) return undefined;
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code < 32 || code === 127) return undefined;
  }
  // Preserve raw spelling through native URL sanitizers: either a leading
  // scheme or a relative prefix without ampersands/colons before /, ? or #.
  if (!/^(?:[a-z][a-z0-9+.-]*:|[^&:/?#]*(?:[/?#]|$))/i.test(value))
    return undefined;
  try {
    const protocol = new URL(value, 'https://markdown.invalid/').protocol;
    if (
      protocol === 'http:' ||
      protocol === 'https:' ||
      (kind === 'link' && (protocol === 'mailto:' || protocol === 'tel:'))
    )
      return value;
  } catch {
    // A malformed destination has no rendered target.
  }
  return undefined;
}
