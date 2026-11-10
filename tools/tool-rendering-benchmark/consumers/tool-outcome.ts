// App-authored interpretation of the benchmark's fixed reference and save schemas.
// An arbitrary JSON result (including an error object) is never a success preview.
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
type Outcome =
  | { text: string; sources?: { title: string; url: string }[] }
  | { status: 'failed'; text: string; retry?: { label: string } }
  | { status: 'receipt'; text: string };
type Decoder = (call: {
  args: unknown;
  result: unknown;
}) => Outcome | undefined;
const record = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const references: Decoder = ({ result }) => {
  const records = Array.isArray(result) ? result : [result];
  if (!records.length || !records.every(reference)) return undefined;
  return {
    text: records.map((row) => row.summary).join(' '),
    sources: records.map(({ title, url }) => ({ title, url })),
  };
};
/**
 * One decoder per benchmark tool, for the library's `toolOutcomes` registry.
 * `retryReads` is the application's own knowledge of which reads its backend
 * can retry; the library decides only when the control is still worth showing.
 */
export const toolDecoders = (options: {
  readonly retryReads: boolean;
}): Record<string, Decoder> => ({
  search_reference: references,
  read_reference: (call) => {
    const error = recoverableReadError(call.result);
    if (error === undefined) return references(call);
    const id = record(call.args)?.id;
    return {
      status: 'failed',
      text: error,
      retry:
        options.retryReads &&
        typeof id === 'string' &&
        /^[a-z0-9-]{1,60}$/.test(id)
          ? { label: `Retry ${id} read` }
          : undefined,
    };
  },
  save_note: ({ result }) => {
    if (saveDeclined(result))
      return { text: 'Save declined. No note was saved.' };
    const row = record(result);
    // A receipt only for the declared saved shape, never for an approval alone.
    return row &&
      row.saved === true &&
      typeof row.id === 'string' &&
      /^note-[1-9]\d*$/.test(row.id) &&
      Object.keys(row).length === 2
      ? {
          status: 'receipt',
          text: `Note ${row.id} in the local benchmark store.`,
        }
      : undefined;
  },
});
