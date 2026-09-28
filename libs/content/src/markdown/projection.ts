import type {
  MarkdownDocumentNode as ParserDocument,
  MarkdownNode as ParserNode,
  CitationDefinition as ParserCitation,
  LinkDefinition as ParserLink,
} from '@cacheplane/partial-markdown';
import type {
  MarkdownDocumentNode,
  MarkdownNode,
  CitationDefinition,
  LinkDefinition,
} from './types.js';

type NestedField =
  | 'parent'
  | 'children'
  | 'task'
  | 'alignments'
  | 'citations'
  | 'linkDefinitions';
const baseFields = ['id', 'type', 'status', 'index'] as const;
// Every parser kind has an explicit domain projection. No unknown fields are copied.
const listedScalarFields = {
  document: [],
  paragraph: [],
  heading: ['level'],
  blockquote: [],
  list: ['ordered', 'start', 'tight', 'markerCol', 'contentCol'],
  'list-item': [],
  'code-block': ['variant', 'language', 'text'],
  'thematic-break': [],
  text: ['text'],
  emphasis: [],
  strong: [],
  strikethrough: [],
  'inline-code': ['text'],
  link: ['url', 'title'],
  autolink: ['url', 'text'],
  image: ['url', 'title', 'alt'],
  'soft-break': [],
  'hard-break': [],
  table: [],
  'table-row': ['isHeader'],
  'table-cell': ['alignment'],
  'citation-reference': ['refId', 'resolved'],
  'link-reference': ['refId', 'label', 'form', 'resolved', 'url', 'title'],
  'math-inline': ['text', 'delimiter'],
  'math-display': ['text', 'delimiter'],
  'html-inline': ['raw'],
  'html-block': ['raw', 'htmlKind'],
} as const satisfies {
  [K in ParserNode['type']]: readonly Exclude<
    keyof Extract<ParserNode, { type: K }>,
    NestedField
  >[];
};
type SupportedNested<K extends ParserNode['type']> =
  | 'parent'
  | 'children'
  | (K extends 'document'
      ? 'citations' | 'linkDefinitions'
      : K extends 'list-item'
      ? 'task'
      : K extends 'table'
      ? 'alignments'
      : never);
type MissingFields = {
  [K in ParserNode['type']]: Exclude<
    keyof Extract<ParserNode, { type: K }>,
    | (typeof baseFields)[number]
    | (typeof listedScalarFields)[K][number]
    | SupportedNested<K>
  >;
}[ParserNode['type']];
// A vendor field addition must be explicitly owned here before types compile.
const scalarFields: [MissingFields] extends [never]
  ? typeof listedScalarFields
  : never = listedScalarFields;

// Only owned values enter this closure. Iterators expose fresh pairs, not storage.
function readonlyDefinitions<V>(
  entries: readonly (readonly [string, V])[]
): ReadonlyMap<string, V> {
  const storage = new Map(entries);
  const collection: ReadonlyMap<string, V> = Object.freeze({
    get size() {
      return storage.size;
    },
    get: (key: string) => storage.get(key),
    has: (key: string) => storage.has(key),
    keys: () => storage.keys(),
    values: () => storage.values(),
    entries: () => storage.entries(),
    [Symbol.iterator]: () => storage[Symbol.iterator](),
    forEach(
      callback: (value: V, key: string, map: ReadonlyMap<string, V>) => void,
      thisArg?: unknown
    ) {
      storage.forEach((value, key) =>
        callback.call(thisArg, value, key, collection)
      );
    },
  });
  return collection;
}

/** @internal Counts domain containers, excluding iterator pairs and function closures. */
export interface ProjectionWork {
  visits: number;
  nodes: number;
  arrays: number;
  definitions: number;
}
export function createProjection(
  work?: ProjectionWork
): (root: ParserDocument | null) => MarkdownDocumentNode | null {
  const cache = new WeakMap<ParserNode, MarkdownNode>();
  type NodeOf<N extends ParserNode> = Extract<
    MarkdownNode,
    { type: N['type'] }
  >;
  function children<N extends ParserNode>(
    nodes: readonly N[],
    prior?: readonly NodeOf<N>[]
  ): readonly NodeOf<N>[] {
    let changed: NodeOf<N>[] | undefined = prior ? undefined : [];
    for (let index = 0; index < nodes.length; index++) {
      const child = project(nodes[index]);
      if (!changed && prior?.[index] !== child)
        changed = prior?.slice(0, index) ?? [];
      changed?.push(child);
    }
    if (!changed && prior && prior.length !== nodes.length)
      changed = prior.slice(0, nodes.length);
    if (!changed && prior) return prior;
    if (work) work.arrays++;
    return Object.freeze(changed ?? []);
  }
  function definitions<T, V>(
    canonical: ReadonlyMap<string, T>,
    prior: ReadonlyMap<string, V> | undefined,
    own: (value: T, before: V | undefined) => V
  ): ReadonlyMap<string, V> {
    let changed: (readonly [string, V])[] | undefined = prior ? undefined : [];
    const oldEntries = prior?.entries();
    let index = 0;
    for (const [key, value] of canonical) {
      const owned = own(value, prior?.get(key)),
        old = oldEntries?.next().value;
      if (!changed && (old?.[0] !== key || old?.[1] !== owned))
        changed = prior ? [...prior].slice(0, index) : [];
      changed?.push([key, owned]);
      index++;
    }
    if (!changed && prior && prior.size !== index)
      changed = [...prior].slice(0, index);
    if (!changed && prior) return prior;
    if (work) {
      work.arrays++;
      work.definitions++;
    }
    return readonlyDefinitions(changed ?? []);
  }
  function citation(
    value: ParserCitation,
    prior?: CitationDefinition
  ): CitationDefinition {
    const ownedChildren = children(value.children, prior?.children);
    if (
      prior &&
      prior.id === value.id &&
      prior.index === value.index &&
      prior.status === value.status &&
      prior.children === ownedChildren
    )
      return prior;
    if (work) work.definitions++;
    return Object.freeze({
      id: value.id,
      index: value.index,
      status: value.status,
      children: ownedChildren,
    });
  }
  function link(value: ParserLink, prior?: LinkDefinition): LinkDefinition {
    if (
      prior &&
      prior.id === value.id &&
      prior.label === value.label &&
      prior.url === value.url &&
      prior.title === value.title &&
      prior.status === value.status
    )
      return prior;
    if (work) work.definitions++;
    return Object.freeze({
      id: value.id,
      label: value.label,
      url: value.url,
      title: value.title,
      status: value.status,
    });
  }
  function project<N extends ParserNode>(node: N): NodeOf<N> {
    if (work) work.visits++;
    const cached = cache.get(node),
      prior = cached?.type === node.type ? cached : undefined;
    let changed: Record<string, unknown> | undefined = prior ? undefined : {};
    if (!prior && work) work.nodes++;
    function field(key: string, value: unknown) {
      if (prior && Object.is(Reflect.get(prior, key), value)) return;
      if (!changed) {
        changed = { ...prior };
        if (work) work.nodes++;
      }
      changed[key] = value;
    }
    field('parent', null);
    for (const key of baseFields) field(key, node[key]);
    for (const key of scalarFields[node.type])
      field(key, Reflect.get(node, key));
    if ('children' in node)
      field(
        'children',
        children(
          node.children as readonly ParserNode[],
          prior && 'children' in prior ? prior.children : undefined
        )
      );
    if (node.type === 'list-item') {
      const old = prior?.type === node.type ? prior.task : undefined;
      let task = old;
      if (!node.task) task = undefined;
      else if (!old || old.checked !== node.task.checked) {
        task = Object.freeze({ checked: node.task.checked });
        if (work) work.definitions++;
      }
      field('task', task);
    }
    if (node.type === 'table') {
      const old = prior?.type === node.type ? prior.alignments : undefined;
      let alignments = old;
      if (
        !old ||
        old.length !== node.alignments.length ||
        node.alignments.some((value, index) => old[index] !== value)
      ) {
        alignments = Object.freeze([...node.alignments]);
        if (work) work.arrays++;
      }
      field('alignments', alignments);
    }
    if (node.type === 'document') {
      const old = prior?.type === node.type ? prior : undefined;
      field('citations', definitions(node.citations, old?.citations, citation));
      field(
        'linkDefinitions',
        definitions(node.linkDefinitions, old?.linkDefinitions, link)
      );
    }
    // The exhaustive scalar table and explicit nested cases preserve each concrete kind.
    const owned = (changed ? Object.freeze(changed) : prior) as NodeOf<N>;
    cache.set(node, owned);
    return owned;
  }
  return (root) => (root === null ? null : project(root));
}
