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
/** The note ID from an admitted save. Anything else, including a declined save, is not a receipt. */
export function savedNoteId(activity: Activity): string | undefined {
  if (
    activity.name !== 'save_note' ||
    activity.phase !== 'complete' ||
    !activity.resultText
  )
    return undefined;
  try {
    const row: unknown = JSON.parse(activity.resultText);
    if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
    const { saved, id } = row as Record<string, unknown>;
    return saved === true &&
      typeof id === 'string' &&
      /^note-[1-9]\d*$/.test(id) &&
      Object.keys(row).length === 2
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}
type Call = Activity & { readonly id: string; readonly argumentsText?: string };
function referenceId(call: Call): string | undefined {
  if (call.name !== 'read_reference' || !call.argumentsText) return undefined;
  try {
    const args: unknown = JSON.parse(call.argumentsText);
    const id = (args as Record<string, unknown> | null)?.id;
    return typeof id === 'string' && /^[a-z0-9-]{1,60}$/.test(id)
      ? id
      : undefined;
  } catch {
    return undefined;
  }
}
/**
 * The reference a failed read may retry, given every call in transcript order.
 * Only the declared recoverable error qualifies, and only until a later read of
 * the same reference exists, so a retried or superseded row stops offering it.
 */
export function retryableReference(
  call: Call,
  calls: readonly Call[]
): string | undefined {
  const id = referenceId(call);
  if (!id || recoverableReadError(call.resultText) === undefined)
    return undefined;
  const index = calls.findIndex((other) => other.id === call.id);
  return index >= 0 &&
    !calls.slice(index + 1).some((other) => referenceId(other) === id)
    ? id
    : undefined;
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
    if (activity.name === 'save_note')
      // A saved note is shown as a receipt in the per-call slot, see savedNoteId.
      return saveDeclined(value)
        ? { text: 'Save declined. No note was saved.' }
        : undefined;
    if (activity.name === 'read_reference') {
      const error = recoverableReadError(value);
      if (error) return { status: 'failed' as const, text: error };
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
