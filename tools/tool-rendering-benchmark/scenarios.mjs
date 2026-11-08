import { createHash } from 'node:crypto';

export const referencePrompt =
  'Use web search to look up the official Angular signals documentation and the official JavaScript Array.prototype.toSorted documentation. Compare what each does in two short bullets, show the sources, and keep the answer under 180 words.';

// Authored benchmark data, not a live search result or a quotation from the sites.
const references = deepFreeze([
  {
    id: 'angular-signals',
    title: 'Angular signals',
    url: 'https://angular.dev/guide/signals',
    summary:
      'Signals represent reactive values. Consumers can update when their dependencies change.',
  },
  {
    id: 'array-to-sorted',
    title: 'Array.prototype.toSorted()',
    url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted',
    summary:
      'toSorted creates a sorted copy of an array while preserving the original array.',
  },
]);

const call = (id, name, args) => ({ id, name, args });
const lookupCalls = [
  call('search-angular', 'search_reference', { query: 'Angular signals' }),
  call('search-sorted', 'search_reference', {
    query: 'Array.prototype.toSorted',
  }),
  call('read-angular', 'read_reference', { id: 'angular-signals' }),
  call('read-sorted', 'read_reference', { id: 'array-to-sorted' }),
];
const scenarios = deepFreeze({
  references: {
    id: 'references',
    prompt: referencePrompt,
    calls: lookupCalls,
    conclusion:
      'Angular signals represent reactive application values. Array.prototype.toSorted creates a sorted array copy. The reference records are fixed benchmark data; their source links are shown for inspection.',
  },
  repeated: {
    id: 'repeated',
    prompt: 'Find Angular signals, then toSorted, then Angular signals again.',
    calls: [
      lookupCalls[0],
      lookupCalls[1],
      call('search-angular-again', 'search_reference', {
        query: 'Angular signals',
      }),
    ],
    conclusion: 'Three independent reference searches completed.',
  },
  'tool-error': {
    id: 'tool-error',
    prompt: 'Read the missing reference.',
    calls: [call('read-missing', 'read_reference', { id: 'not-a-reference' })],
    conclusion: 'The reference is unavailable.',
  },
  falsy: {
    id: 'falsy',
    prompt: 'Inspect zero, false, empty text, an empty list, and null.',
    calls: ['zero', 'false', 'empty', 'array', 'null'].map((kind) =>
      call('inspect-' + kind, 'inspect_value', { kind })
    ),
    conclusion: 'All five inspections completed successfully.',
  },
  slow: {
    id: 'slow',
    prompt: 'Look up the references slowly so I can stop the operation.',
    calls: lookupCalls,
    delayMs: 2000,
    conclusion: 'The slow reference lookup completed.',
  },
  approval: {
    id: 'approval',
    prompt: 'Draft a comparison note. Ask for approval before saving it.',
    calls: [
      call('save-comparison', 'save_note', {
        text: 'Signals manage reactive values; toSorted creates a sorted copy.',
      }),
    ],
    requiresApproval: true,
    conclusion: 'The comparison note was saved in the local benchmark store.',
  },
  'native-approval': {
    id: 'native-approval',
    prompt:
      'Draft a comparison note. Pause for a native approval before saving it.',
    calls: [
      call('save-comparison', 'save_note', {
        text: 'Signals manage reactive values; toSorted creates a sorted copy.',
      }),
    ],
    nativeApproval: true,
    conclusion: 'The comparison note was saved in the local benchmark store.',
  },
  'partial-failure': {
    id: 'partial-failure',
    prompt: 'Read both references. Retry the failed read explicitly.',
    retryPrompt: 'Retry the failed read explicitly.',
    calls: [lookupCalls[2], lookupCalls[3]],
    recoverableRead: 'read-sorted',
    conclusion: 'Both authored references are now available.',
  },
  'long-mixed': {
    id: 'long-mixed',
    prompt:
      'Inspect a long sequence of reference reads with one recoverable failure.',
    calls: Array.from({ length: 18 }, (_, index) =>
      call('long-read-' + index, 'read_reference', {
        id:
          index === 8
            ? 'not-a-reference'
            : index % 2
            ? 'array-to-sorted'
            : 'angular-signals',
      })
    ),
    continueOnError: true,
    conclusion:
      'Seventeen reference reads completed; one reference was unavailable.',
  },
});

export function getScenario(id) {
  if (!Object.hasOwn(scenarios, id))
    throw new Error('Unknown benchmark scenario');
  return scenarios[id];
}

export async function executeTool(name, args, context = {}) {
  if (name === 'search_reference') {
    if (typeof args?.query !== 'string' || args.query.length > 200)
      throw new Error('Invalid reference query');
    const query = args.query.toLowerCase();
    return references.filter((item) =>
      query.includes(item.id === 'angular-signals' ? 'angular' : 'tosorted')
    );
  }
  if (name === 'read_reference') {
    const reference = references.find((item) => item.id === args?.id);
    if (!reference) throw new Error('Reference unavailable');
    return reference;
  }
  if (name === 'inspect_value') {
    const values = { zero: 0, false: false, empty: '', array: [], null: null };
    if (!Object.hasOwn(values, args?.kind))
      throw new Error('Invalid inspection kind');
    return values[args.kind];
  }
  if (name === 'save_note') {
    if (!context.approved || typeof context.save !== 'function')
      throw new Error('Approval required');
    if (typeof args?.text !== 'string' || args.text.length > 1000)
      throw new Error('Invalid note');
    return context.save(args.text);
  }
  throw new Error('Unsupported benchmark tool');
}

export function argumentFragments(args, size = 8) {
  if (!Number.isInteger(size) || size < 1)
    throw new Error('Invalid fragment size');
  const text = JSON.stringify(args);
  return Array.from({ length: Math.ceil(text.length / size) }, (_, index) =>
    text.slice(index * size, (index + 1) * size)
  );
}

export function canonicalJson(value) {
  if (Array.isArray(value))
    return '[' + value.map(canonicalJson).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
        .join(',') +
      '}'
    );
  }
  const text = JSON.stringify(value);
  if (text === undefined)
    throw new Error('Benchmark hashes require JSON values');
  return text;
}

export function hashValue(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
