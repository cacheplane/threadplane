import type { Message, MessageDelivery } from '@threadplane/chat';

type DescriptorSnapshot = ReadonlyArray<readonly [PropertyKey, PropertyDescriptor]>;
type DeliverySnapshot = readonly [string, MessageDelivery['phase'], string | undefined];
interface CachedMessage {
  raw: DescriptorSnapshot;
  projected: Message;
  output: DescriptorSnapshot;
  deliveryObject: MessageDelivery;
  deliveryProperties: DescriptorSnapshot;
  delivery: DeliverySnapshot;
  duration: number | undefined;
}
interface ProjectionOptions<Raw extends object> {
  project: (raw: Raw) => Message;
  getDelivery: (id: string) => MessageDelivery;
  getReasoningDurationMs?: (id: string) => number | undefined;
}
const normalizedFields = [
  'type', 'name', 'tool_call_id', 'reasoning', 'additional_kwargs', 'tool_calls',
] as const;
const primitive = (value: unknown) => value === null
  || (typeof value !== 'object' && typeof value !== 'function');
const data = (descriptor: PropertyDescriptor | undefined): descriptor is PropertyDescriptor & { value: unknown } =>
  descriptor !== undefined && Object.hasOwn(descriptor, 'value');

function plainRecord(raw: object): boolean {
  const prototype: unknown = Object.getPrototypeOf(raw);
  if (prototype !== null && prototype !== Object.prototype) return false;
  if ('_getType' in raw) return false;
  for (const key of normalizedFields) {
    if (key in raw && !Object.hasOwn(raw, key)) return false;
  }
  for (const key of ['id', 'type', 'content']) {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (!data(descriptor) || typeof descriptor.value !== 'string') return false;
    if (key === 'id' && descriptor.value.length === 0) return false;
  }
  return true;
}
function capture(object: object, allowed: (key: PropertyKey, value: unknown) => boolean): DescriptorSnapshot | undefined {
  const snapshot: Array<readonly [PropertyKey, PropertyDescriptor]> = [];
  for (const key of Reflect.ownKeys(object)) {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    if (!data(descriptor) || !allowed(key, descriptor.value)) return undefined;
    snapshot.push([key, descriptor]);
  }
  return snapshot;
}
function unchanged(object: object, snapshot: DescriptorSnapshot): boolean {
  const keys = Reflect.ownKeys(object);
  if (keys.length !== snapshot.length) return false;
  return snapshot.every(([key, previous], index) => {
    if (keys[index] !== key) return false;
    const current = Object.getOwnPropertyDescriptor(object, key);
    return data(current) && Object.is(current.value, previous.value)
      && current.enumerable === previous.enumerable
      && current.configurable === previous.configurable
      && current.writable === previous.writable;
  });
}
const deliverySnapshot = (delivery: MessageDelivery): DeliverySnapshot => [
  delivery.generation, delivery.phase, delivery.phase === 'complete' ? delivery.outcome : undefined,
];
const sameDelivery = (current: DeliverySnapshot, previous: DeliverySnapshot) =>
  current.every((value, index) => value === previous[index]);

/** Internal conservative projection reuse. Opaque SDK messages always project
 * afresh; only complete primitive records can prove that raw extras are intact.
 * The cache owns only entries in the latest successfully consumed collection.
 */
export function createMemoizedMessageProjector<Raw extends object>(options: ProjectionOptions<Raw>):
  (messages: readonly Raw[]) => Message[] {
  let previous = new Map<Raw, CachedMessage>();
  return messages => {
    const next = new Map<Raw, CachedMessage>();
    const seen = new Set<Raw>(), duplicates = new Set<Raw>();
    for (const raw of messages) {
      if (seen.has(raw)) duplicates.add(raw);
      else seen.add(raw);
    }
    const result = messages.map(raw => {
      let snapshot: DescriptorSnapshot | undefined;
      let delivery: DeliverySnapshot | undefined;
      let duration: number | undefined;
      try {
        if (!duplicates.has(raw) && plainRecord(raw)) {
          const id = Object.getOwnPropertyDescriptor(raw, 'id')!.value as string;
          delivery = deliverySnapshot(options.getDelivery(id));
          const reasoning = Object.getOwnPropertyDescriptor(raw, 'reasoning')?.value as unknown;
          duration = typeof reasoning === 'string' && reasoning.length > 0
            ? options.getReasoningDurationMs?.(id) : undefined;
          const cached = previous.get(raw);
          if (cached && unchanged(raw, cached.raw)
            && sameDelivery(delivery, cached.delivery) && Object.is(duration, cached.duration)
            && unchanged(cached.projected, cached.output)
            && unchanged(cached.deliveryObject, cached.deliveryProperties)) {
            next.set(raw, cached);
            return cached.projected;
          }
          snapshot = capture(raw, (_key, value) => primitive(value));
        }
      } catch {
        // Snapshot inspection cannot replace the original projection/error.
      }
      const projected = options.project(raw);
      if (snapshot && delivery) {
        try {
          const output = capture(projected, (key, value) => primitive(value)
            || (key === 'extra' && value === raw)
            || (key === 'delivery' && value === projected.delivery));
          const deliveryProperties = capture(projected.delivery, (_key, value) => primitive(value));
          if (output && deliveryProperties) next.set(raw, {
            raw: snapshot, projected, output, deliveryObject: projected.delivery, deliveryProperties,
            delivery: deliverySnapshot(projected.delivery), duration: projected.reasoningDurationMs,
          });
        } catch {
          // A nonstandard output stays on the conservative path.
        }
      }
      return projected;
    });
    previous = next;
    return result;
  };
}
