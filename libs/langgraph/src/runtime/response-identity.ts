import { record } from './wire-message.js';

type Item = {
  readonly type: 'text' | 'function_call' | 'reasoning';
  readonly id: string;
  readonly callId?: string;
};
type Slot = {
  readonly index: number;
  readonly type: Item['type'];
  readonly id?: string;
  readonly callId?: string;
};
type Reference = { readonly id?: string; readonly callId?: string };
type Observation = {
  readonly id: string;
  readonly slots: readonly Slot[];
  readonly references: readonly Reference[];
  readonly tainted: boolean;
};
type Claim = {
  readonly id: string;
  readonly items: readonly Item[];
  readonly references: readonly Reference[];
};
/** A model response the provider opened in one graph task. `run` is the
 * placeholder id its following chunks arrived under, once that is proven. */
type Opening = {
  readonly id: string;
  readonly scope: string;
  readonly run?: string;
  /** No placeholder id can be bound any more: the task held two unbound
   * responses at once, so which response a new run continues is unknown. */
  readonly closed?: true;
  /** Final state named the placeholder id as a message of its own. */
  readonly retired?: true;
};
/** Private to a physical stream projection (and its independently routed namespace).
 * Only primitive copies survive an event. Reconnection preserves this evidence;
 * a new physical projection starts without it. */
export interface ResponseIdentity {
  readonly chunks: readonly Observation[];
  readonly claims: readonly Claim[];
  readonly aliases: readonly { readonly from: string; readonly to: string }[];
  readonly openings?: readonly Opening[];
}
/** LangChain gives a chunk that carries no provider id the id of the model
 * run that produced it, under this prefix. It names a run, not a message. */
const RUN_PLACEHOLDER = 'lc_run-';
const itemType = (type: unknown): type is Item['type'] =>
  type === 'text' || type === 'function_call' || type === 'reasoning';
const nonempty = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0;
const key = (item: Item) => JSON.stringify([item.type, item.id, item.callId]);
const same = (a: readonly Item[], b: readonly Item[]) =>
  a.length === b.length &&
  a.every((item) => b.some((other) => key(item) === key(other)));
const overlaps = (a: readonly Reference[], b: readonly Reference[]) =>
  a.some((item) =>
    b.some(
      (other) =>
        (item.id !== undefined && item.id === other.id) ||
        (item.callId !== undefined && item.callId === other.callId)
    )
  );
function references(content: unknown): readonly Reference[] {
  if (!Array.isArray(content)) return [];
  return content.flatMap((value) => {
    const block = record(value);
    const id = block?.['id'];
    const callId = block?.['call_id'];
    return nonempty(id) || nonempty(callId)
      ? [
          {
            ...(nonempty(id) ? { id } : {}),
            ...(nonempty(callId) ? { callId } : {}),
          },
        ]
      : [];
  });
}
function complete(slots: readonly Slot[]): readonly Item[] | undefined {
  const items: Item[] = [];
  for (const slot of slots) {
    if (
      !nonempty(slot.id) ||
      (slot.type === 'function_call' && !nonempty(slot.callId))
    )
      return undefined;
    items.push({
      type: slot.type,
      id: slot.id,
      ...(slot.callId === undefined ? {} : { callId: slot.callId }),
    });
  }
  return items.length ? items : undefined;
}

function observe(
  previous: Observation | undefined,
  id: string,
  content: unknown
): Observation {
  const slots = [...(previous?.slots ?? [])];
  const observed = [...(previous?.references ?? [])];
  for (const reference of references(content))
    if (
      !observed.some(
        (old) => old.id === reference.id && old.callId === reference.callId
      )
    )
      observed.push(reference);
  let tainted = previous?.tainted ?? false;
  // An empty string states nothing; any other string is text no item owns.
  if (!Array.isArray(content))
    return {
      id,
      slots,
      references: observed,
      tainted: tainted || content !== '',
    };
  for (const value of content) {
    const block = record(value);
    const type = block?.['type'];
    const index = block?.['index'];
    if (
      !itemType(type) ||
      typeof index !== 'number' ||
      !Number.isInteger(index) ||
      index < 0
    ) {
      tainted = true;
      continue;
    }
    const itemId = block?.['id'];
    const callId = block?.['call_id'];
    if (
      (itemId !== undefined && !nonempty(itemId)) ||
      (callId !== undefined && (!nonempty(callId) || type !== 'function_call'))
    )
      tainted = true;
    const position = slots.findIndex((slot) => slot.index === index);
    const old = slots[position];
    if (
      old &&
      (old.type !== type ||
        (old.id !== undefined && itemId !== undefined && old.id !== itemId) ||
        (old.callId !== undefined &&
          callId !== undefined &&
          old.callId !== callId))
    )
      tainted = true;
    const slot: Slot = {
      index,
      type,
      ...(old?.id !== undefined || nonempty(itemId)
        ? { id: old?.id ?? (itemId as string) }
        : {}),
      ...(old?.callId !== undefined || nonempty(callId)
        ? { callId: old?.callId ?? (callId as string) }
        : {}),
    };
    if (position < 0) slots.push(slot);
    else slots[position] = slot;
  }
  if (
    slots.some(
      (slot, index) =>
        slot.id !== undefined &&
        slots.some(
          (other, at) =>
            at !== index &&
            (other.id === slot.id ||
              (slot.callId !== undefined && other.callId === slot.callId))
        )
    )
  )
    tainted = true;
  return { id, slots, references: observed, tainted };
}
function canonicalItems(raw: Record<string, unknown>) {
  const items: Item[] = [];
  let eligible = true;
  if (!Array.isArray(raw['content']) || raw['content'].length === 0)
    return { items, eligible: false };
  for (const value of raw['content']) {
    const block = record(value);
    const type = block?.['type'];
    const id = block?.['id'];
    const callId = block?.['call_id'];
    if (!itemType(type) || !nonempty(id)) {
      eligible = false;
      continue;
    }
    if (type === 'function_call' && !nonempty(callId)) eligible = false;
    const item: Item = {
      type,
      id,
      ...(type === 'function_call' && nonempty(callId) ? { callId } : {}),
    };
    if (
      items.some(
        (other) =>
          other.id === id ||
          (item.callId !== undefined && item.callId === other.callId)
      )
    )
      eligible = false;
    items.push(item);
  }
  return { items, eligible };
}
/**
 * Binds a model run's placeholder id to the response that run opened.
 *
 * A streamed OpenAI response opens with a chunk under the provider's response
 * id (`response_metadata.id` equals the chunk id). The provider gives the
 * chunks that follow no id, so they arrive under the placeholder id of the
 * same model run. The opening chunk is always the first of its run, so when a
 * placeholder id is seen for the first time in a graph task that holds exactly
 * one response without a run, that run is the one that opened it.
 *
 * Nothing is bound when the task holds two unbound responses at once, when
 * the placeholder id was seen before the response opened, or outside a named
 * graph task. Text, adjacency and node names are never consulted.
 */
function observeOpening(
  openings: readonly Opening[],
  scope: string,
  id: string,
  declared: boolean,
  known: boolean,
  baselineIds: readonly string[]
): readonly Opening[] {
  if (openings.some((entry) => entry.id === id || entry.run === id))
    return openings;
  const unbound = openings.filter(
    (entry) => entry.scope === scope && entry.run === undefined
  );
  if (declared) {
    if (id.startsWith(RUN_PLACEHOLDER) || baselineIds.includes(id))
      return openings;
    if (!unbound.length) return [...openings, { id, scope }];
    return [
      ...openings.map((entry) =>
        unbound.includes(entry) ? { ...entry, closed: true as const } : entry
      ),
      { id, scope, closed: true },
    ];
  }
  if (
    !id.startsWith(RUN_PLACEHOLDER) ||
    known ||
    baselineIds.includes(id) ||
    unbound.length !== 1 ||
    unbound[0].closed
  )
    return openings;
  return openings.map((entry) =>
    entry === unbound[0] ? { ...entry, run: id } : entry
  );
}
export function observeResponseIdentity(
  previous: ResponseIdentity | undefined,
  incoming: readonly Record<string, unknown>[],
  terminal: boolean,
  baselineIds: readonly string[],
  /** The graph task the event's messages were streamed from, when it names
   * one (`messageMetadata.langgraph_checkpoint_ns`). */
  scope?: string
) {
  const chunks = [...(previous?.chunks ?? [])];
  const claims = [...(previous?.claims ?? [])];
  const aliases = [...(previous?.aliases ?? [])];
  let openings = previous?.openings ?? [];
  const canonical: (Claim & { eligible: boolean })[] = [];
  for (const raw of incoming) {
    const id = raw['id'];
    const metadata = record(raw['response_metadata']);
    // A full message under a placeholder id is a message of its own, whatever
    // produced it: the run it names was never part of another response.
    if (
      terminal &&
      nonempty(id) &&
      (raw['type'] === 'ai' || raw['type'] === 'AIMessage') &&
      openings.some((entry) => entry.run === id && !entry.retired)
    )
      openings = openings.map((entry) =>
        entry.run === id ? { ...entry, retired: true as const } : entry
      );
    if (!nonempty(id) || metadata?.['model_provider'] !== 'openai') continue;
    if (raw['type'] === 'AIMessageChunk') {
      const index = chunks.findIndex((entry) => entry.id === id);
      if (nonempty(scope))
        openings = observeOpening(
          openings,
          scope,
          id,
          metadata['id'] === id,
          index >= 0,
          baselineIds
        );
      const observation = observe(chunks[index], id, raw['content']);
      if (index < 0) chunks.push(observation);
      else chunks[index] = observation;
    } else if (
      terminal &&
      (raw['type'] === 'ai' || raw['type'] === 'AIMessage') &&
      metadata['id'] === id
    ) {
      canonical.push({
        id,
        ...canonicalItems(raw),
        references: references(raw['content']),
      });
    }
  }
  // Scan the entire terminal batch before admitting any binding. Historical and
  // already observed canonical owners also participate in ambiguity rejection.
  for (const claim of canonical) {
    const index = claims.findIndex((entry) => entry.id === claim.id);
    const old = claims[index];
    const merged = {
      id: claim.id,
      references: [
        ...(old?.references ?? []),
        ...claim.references.filter(
          (reference) =>
            !old?.references.some(
              (previous) =>
                previous.id === reference.id &&
                previous.callId === reference.callId
            )
        ),
      ],
      items: [
        ...(old?.items ?? []),
        ...claim.items.filter(
          (item) => !old?.items.some((other) => key(item) === key(other))
        ),
      ],
    };
    if (index < 0) claims.push(merged);
    else claims[index] = merged;
  }
  const merges: { from: string; to: string }[] = [];
  for (const claim of canonical) {
    if (
      !claim.eligible ||
      aliases.some((alias) => alias.from === claim.id) ||
      chunks.some((entry) => entry.id === claim.id && entry.tainted) ||
      !same(
        claims.find((entry) => entry.id === claim.id)!.items,
        claim.items
      ) ||
      baselineIds.includes(claim.id) ||
      claims.some(
        (other) =>
          other.id !== claim.id && overlaps(other.references, claim.references)
      )
    )
      continue;
    const owners = chunks.filter(
      (entry) =>
        entry.id !== claim.id && overlaps(entry.references, claim.references)
    );
    if (owners.length !== 1) continue;
    const owner = owners[0];
    const items = complete(owner.slots);
    if (
      openings.some((entry) => entry.run === owner.id && !entry.retired) ||
      owner.tainted ||
      baselineIds.includes(owner.id) ||
      !items ||
      !same(items, claim.items) ||
      claims.some((other) => other.id === owner.id) ||
      aliases.some((alias) => alias.from === owner.id || alias.to === owner.id)
    )
      continue;
    const binding = { from: owner.id, to: claim.id };
    aliases.push(binding);
    merges.push(binding);
  }
  return {
    evidence: {
      chunks,
      claims,
      aliases,
      ...(openings.length ? { openings } : {}),
    } satisfies ResponseIdentity,
    merges,
  };
}

/** A retained alias is also a tombstone: later contradictory evidence retires
 * routing but never enables a chain or rewrites already reconciled history. */
export function responseChunkId(
  evidence: ResponseIdentity,
  id: string
): string {
  const opening = evidence.openings?.find(
    (entry) => entry.run === id && !entry.retired
  );
  if (opening) return opening.id;
  const alias = evidence.aliases.find((entry) => entry.from === id);
  if (!alias || evidence.claims.some((claim) => claim.id === id)) return id;
  const owner = evidence.chunks.find((entry) => entry.id === id);
  const target = evidence.claims.find((claim) => claim.id === alias.to);
  const items = owner && !owner.tainted ? complete(owner.slots) : undefined;
  if (
    !owner ||
    !target ||
    !items ||
    !same(items, target.items) ||
    evidence.claims.some(
      (claim) =>
        claim.id !== target.id && overlaps(claim.references, target.references)
    ) ||
    evidence.chunks.some(
      (chunk) =>
        chunk.id !== id &&
        chunk.id !== target.id &&
        overlaps(chunk.references, target.references)
    )
  )
    return id;
  return alias.to;
}
