// App-authored interpretation of the benchmark's fixed reference and save schemas.
// An arbitrary JSON result (including an error object) is never a success preview.
type Activity = {
  readonly name: string;
  readonly phase?: string;
  readonly resultText?: string;
};
type Reference = { title: string; url: string; summary: string };
const referenceUrls = new Set([
  'https://angular.dev/guide/signals',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted',
]);
// Only these benchmark scenarios author recoverable tool failures as results.
// This is application schema interpretation, not generic SDK JSON inference.
export function recoverableReadError(result: unknown): string | undefined {
  let value = result;
  if (typeof result === 'string') {
    try {
      value = JSON.parse(result);
    } catch {
      return undefined;
    }
  }
  if (!value || typeof value !== 'object') return undefined;
  const row = value as Record<string, unknown>;
  return row.recoverable === true && typeof row.error === 'string'
    ? row.error
    : undefined;
}
export function saveDeclined(result: unknown): boolean {
  let value = result;
  if (typeof result === 'string') {
    try {
      value = JSON.parse(result);
    } catch {
      return false;
    }
  }
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    row.saved === false &&
    row.cancelled === true &&
    Object.keys(row).length === 2
  );
}
function reference(value: unknown): value is Reference {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.title === 'string' &&
    row.title.length > 0 &&
    typeof row.summary === 'string' &&
    row.summary.length > 0 &&
    typeof row.url === 'string' &&
    referenceUrls.has(row.url)
  );
}
export const toolLabel = (name: string) =>
  name === 'search_reference'
    ? 'Finding reference sources'
    : name === 'read_reference'
    ? 'Reading reference sources'
    : undefined;
export function toolOutcome(activity: Activity) {
  if (
    activity.phase !== 'complete' ||
    !activity.resultText ||
    !['search_reference', 'read_reference', 'save_note'].includes(activity.name)
  )
    return undefined;
  try {
    const value: unknown = JSON.parse(activity.resultText);
    if (activity.name === 'save_note') {
      if (saveDeclined(value))
        return { text: 'Save declined. No note was saved.' };
      if (!value || typeof value !== 'object') return undefined;
      const row = value as Record<string, unknown>;
      if (
        row.saved !== true ||
        typeof row.id !== 'string' ||
        !/^note-[1-9]\d*$/.test(row.id) ||
        Object.keys(row).length !== 2
      )
        return undefined;
      return { text: `Saved note ${row.id} in the local benchmark store.` };
    }
    const records = Array.isArray(value) ? value : [value];
    if (!records.length || !records.every(reference)) return undefined;
    return {
      text: records.map((row) => row.summary).join(' '),
      sources: records.map(({ title, url }) => ({ title, url })),
    };
  } catch {
    return undefined;
  }
}
