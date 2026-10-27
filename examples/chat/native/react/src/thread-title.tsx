/** Highlight the first literal loaded-title match without changing source text. */
export function renderThreadTitle(title: string, query: string) {
  const needle = query.trim().toLowerCase();
  if (!needle) return title;
  // Search the whole string, matching the shared projection (including final sigma).
  const start = title.toLowerCase().indexOf(needle);
  if (start < 0) return title;
  const end = start + needle.length;
  let sourceOffset = 0;
  let foldedOffset = 0;
  let sourceStart = 0;
  let sourceEnd = title.length;
  for (const character of title) {
    const nextFolded = foldedOffset + character.toLowerCase().length;
    if (foldedOffset <= start && start < nextFolded) sourceStart = sourceOffset;
    if (foldedOffset < end && end <= nextFolded) {
      sourceEnd = sourceOffset + character.length;
      break;
    }
    foldedOffset = nextFolded;
    sourceOffset += character.length;
  }
  return (
    <>
      {title.slice(0, sourceStart)}
      <mark>{title.slice(sourceStart, sourceEnd)}</mark>
      {title.slice(sourceEnd)}
    </>
  );
}
