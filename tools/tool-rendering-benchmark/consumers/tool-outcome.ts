// App-authored interpretation of the benchmark's fixed reference and save schemas.
// An arbitrary JSON result (including an error object) is never a success preview.
export type Reference = { title: string; url: string; summary: string };
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
    : name === 'plan_workflow'
    ? 'Planning the work'
    : name === 'delegate_research'
    ? 'Delegating the reading'
    : name === 'save_note'
    ? 'Saving the note'
    : undefined;
/**
 * The deep-workflow scenario keeps one thread across a reload so its history
 * can be restored; every other scenario starts a fresh thread per page load.
 */
export function benchmarkThread(scenario: string): string | undefined {
  if (scenario !== 'deep-workflow') return undefined;
  const key = 'benchmark-thread:' + scenario;
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}
export const forgetBenchmarkThread = (scenario: string) =>
  sessionStorage.removeItem('benchmark-thread:' + scenario);
type Outcome =
  | {
      text: string;
      sources?: { title: string; url: string; snippet?: string }[];
    }
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
/**
 * How a confirmed reference result is arranged beside the assistant's answer.
 * `sources` (the default) shows nothing per call: the references are listed
 * once in the message's Sources panel. `summary` repeats each reference's
 * summary above the answer; `compact` shows one "Sources checked." line;
 * `cards` shows one card per distinct reference in the per-call result slot.
 * A layout only changes this application's presentation of its own schema.
 */
export type Layout = 'sources' | 'summary' | 'compact' | 'cards';
export const layoutFrom = (search: string): Layout => {
  const value = new URLSearchParams(search).get('layout');
  return value === 'summary' || value === 'compact' || value === 'cards'
    ? value
    : 'sources';
};
const referenceRecords = (result: unknown): Reference[] | undefined => {
  const records = Array.isArray(result) ? result : [result];
  return records.length && records.every(reference) ? records : undefined;
};
const references =
  (layout: Layout): Decoder =>
  ({ result }) => {
    const records = referenceRecords(result);
    if (!records || layout === 'cards') return undefined;
    // The library lists declared sources once in the message's Sources panel.
    const sources = records.map(({ title, url, summary }) => ({
      title,
      url,
      snippet: summary,
    }));
    return {
      text:
        layout === 'sources'
          ? ''
          : layout === 'compact'
          ? 'Sources checked.'
          : records.map((row) => row.summary).join(' '),
      sources,
    };
  };
/**
 * Cards per call for the `cards` layout: each distinct reference appears once,
 * on the last completed call that returned it, so a search followed by a read
 * of the same reference does not show it twice.
 */
export function referenceCards(
  calls: readonly { readonly id: string; readonly resultText?: string }[]
): ReadonlyMap<string, readonly Reference[]> {
  const owner = new Map<string, { id: string; row: Reference }>();
  for (const call of calls) {
    if (call.resultText === undefined) continue;
    let result: unknown;
    try {
      result = JSON.parse(call.resultText);
    } catch {
      continue;
    }
    for (const row of referenceRecords(result) ?? [])
      owner.set(row.url, { id: call.id, row });
  }
  const cards = new Map<string, Reference[]>();
  for (const { id, row } of owner.values())
    cards.set(id, [...(cards.get(id) ?? []), row]);
  return cards;
}
/**
 * One decoder per benchmark tool, for the library's `toolOutcomes` registry.
 * `retryReads` is the application's own knowledge of which reads its backend
 * can retry; the library decides only when the control is still worth showing.
 */
export const toolDecoders = (options: {
  readonly retryReads: boolean;
  readonly layout?: Layout;
}): Record<string, Decoder> => ({
  search_reference: references(options.layout ?? 'sources'),
  read_reference: (call) => {
    const error = recoverableReadError(call.result);
    if (error === undefined)
      return references(options.layout ?? 'sources')(call);
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
  plan_workflow: ({ result }) => {
    const steps = record(result)?.steps;
    if (!Array.isArray(steps) || !steps.length) return undefined;
    const texts = steps.map((step) => record(step)?.text);
    return texts.every((text) => typeof text === 'string' && text)
      ? {
          text:
            'Plan: ' +
            texts.map((text, index) => `${index + 1}. ${text}`).join(' · '),
        }
      : undefined;
  },
  delegate_research: ({ result }) => {
    const row = record(result);
    return row && row.delegated === true && Array.isArray(row.references)
      ? {
          text: `The reader checked ${row.references.length} references.`,
        }
      : undefined;
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
