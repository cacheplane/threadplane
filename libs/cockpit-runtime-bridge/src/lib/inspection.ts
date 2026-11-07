export const RUNTIME_INSPECTION_VERSION = 1 as const;
export const INSPECTION_LIMITS = Object.freeze({
  messages: 50,
  calls: 20,
  scalarKeys: 32,
  textLength: 2000,
  labelLength: 128,
  encodedBytes: 64 * 1024,
});

export type InspectionScalar = string | number | boolean | null;
export type InspectionState = Readonly<Record<string, InspectionScalar>>;
export type InspectionMessage = Readonly<{
  id: string;
  role: string;
  text: string;
}>;
export type InspectionCall = Readonly<{
  id: string;
  name: 'submit';
  input: Readonly<{ message: string }>;
  status: 'pending' | 'settled' | 'rejected';
}>;
export type InspectionEvent = Readonly<{
  type: string;
  payload: InspectionState | null;
}>;
export type InspectionFrame = Readonly<{
  sequence: number;
  elapsedMs: number;
  framework: 'angular' | 'react';
  messages: readonly InspectionMessage[];
  state: InspectionState | null;
  busy: boolean;
  calls: readonly InspectionCall[];
  event: InspectionEvent;
  limited: boolean;
}>;
export type RuntimeInspectionMessage = Readonly<{
  type: 'tplane:runtime-inspection';
  version: typeof RUNTIME_INSPECTION_VERSION;
  nonce: string;
  generation: number;
  frame: InspectionFrame;
}>;
export type InspectionRecorder = {
  observe(snapshot: unknown, event?: InspectionEvent): void;
  startCall(message: string): string | null;
  settleCall(id: string | null, status: 'settled' | 'rejected'): void;
  reset(): void;
  dispose(): void;
};

// Configuration, headers, and error details are never inspection state.
const privateKey =
  /(?:api.?key|authorization|password|secret|token|headers?|config(?:uration)?|error)/i;
const frameKeys = [
  'sequence',
  'elapsedMs',
  'framework',
  'messages',
  'state',
  'busy',
  'calls',
  'event',
  'limited',
];

function record(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return null;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? (value as Record<string, unknown>)
    : null;
}

function data(value: object, key: PropertyKey): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function exact(
  value: unknown,
  keys: readonly string[]
): Record<string, unknown> | null {
  const input = record(value);
  if (!input || Reflect.ownKeys(input).length !== keys.length) return null;
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (!descriptor || !('value' in descriptor)) return null;
    result[key] = descriptor.value;
  }
  return result;
}

function string(
  value: unknown,
  max: number = INSPECTION_LIMITS.textLength
): value is string {
  return typeof value === 'string' && value.length <= max;
}

function label(value: unknown): value is string {
  return (
    string(value, INSPECTION_LIMITS.labelLength) && value.trim().length > 0
  );
}

function scalar(value: unknown): value is InspectionScalar {
  return (
    value === null ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    string(value)
  );
}

function parseState(value: unknown): InspectionState | null | undefined {
  if (value === null) return null;
  const input = record(value);
  if (!input) return undefined;
  const keys = Reflect.ownKeys(input);
  if (keys.length > INSPECTION_LIMITS.scalarKeys) return undefined;
  const result: Record<string, InspectionScalar> = Object.create(null);
  for (const key of keys) {
    if (!label(key) || privateKey.test(key)) return undefined;
    const item = data(input, key);
    if (!scalar(item)) return undefined;
    result[key] = item;
  }
  return Object.freeze(result);
}

function parseArray<T>(
  value: unknown,
  max: number,
  parse: (value: unknown) => T | null
): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const length = data(value, 'length');
  if (
    typeof length !== 'number' ||
    length > max ||
    Reflect.ownKeys(value).length !== length + 1
  )
    return null;
  const result: T[] = [];
  for (let i = 0; i < length; i++) {
    const item = parse(data(value, String(i)));
    if (item === null) return null;
    result.push(item);
  }
  return Object.freeze(result);
}

function parseMessage(value: unknown): InspectionMessage | null {
  const item = exact(value, ['id', 'role', 'text']);
  return item && label(item.id) && label(item.role) && string(item.text)
    ? Object.freeze({ id: item.id, role: item.role, text: item.text })
    : null;
}

function parseCall(value: unknown): InspectionCall | null {
  const item = exact(value, ['id', 'name', 'input', 'status']);
  const input = item && exact(item.input, ['message']);
  return item &&
    input &&
    label(item.id) &&
    item.name === 'submit' &&
    string(input.message) &&
    (item.status === 'pending' ||
      item.status === 'settled' ||
      item.status === 'rejected')
    ? Object.freeze({
        id: item.id,
        name: 'submit',
        input: Object.freeze({ message: input.message }),
        status: item.status,
      })
    : null;
}

function encodedSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

export function parseInspectionFrame(value: unknown): InspectionFrame | null {
  try {
    const input = exact(value, frameKeys);
    if (
      !input ||
      !Number.isSafeInteger(input.sequence) ||
      (input.sequence as number) < 1 ||
      typeof input.elapsedMs !== 'number' ||
      !Number.isFinite(input.elapsedMs) ||
      input.elapsedMs < 0 ||
      (input.framework !== 'angular' && input.framework !== 'react') ||
      typeof input.busy !== 'boolean' ||
      typeof input.limited !== 'boolean'
    )
      return null;
    const messages = parseArray(
      input.messages,
      INSPECTION_LIMITS.messages,
      parseMessage
    );
    const calls = parseArray(input.calls, INSPECTION_LIMITS.calls, parseCall);
    const state = parseState(input.state);
    const event = exact(input.event, ['type', 'payload']);
    const payload = event && parseState(event.payload);
    if (
      !messages ||
      !calls ||
      state === undefined ||
      !event ||
      !label(event.type) ||
      payload === undefined
    )
      return null;
    const result: InspectionFrame = Object.freeze({
      sequence: input.sequence as number,
      elapsedMs: input.elapsedMs,
      framework: input.framework,
      messages,
      calls,
      state,
      busy: input.busy,
      event: Object.freeze({ type: event.type, payload }),
      limited: input.limited,
    });
    return encodedSize(result) <= INSPECTION_LIMITS.encodedBytes
      ? result
      : null;
  } catch {
    return null;
  }
}

export function parseRuntimeInspectionMessage(
  value: unknown
): RuntimeInspectionMessage | null {
  try {
    const input = exact(value, [
      'type',
      'version',
      'nonce',
      'generation',
      'frame',
    ]);
    if (
      !input ||
      input.type !== 'tplane:runtime-inspection' ||
      input.version !== RUNTIME_INSPECTION_VERSION ||
      !label(input.nonce) ||
      Array.from(input.nonce).some((character) => {
        const code = character.charCodeAt(0);
        return code <= 31 || (code >= 127 && code <= 159);
      }) ||
      !Number.isSafeInteger(input.generation) ||
      (input.generation as number) < 0
    )
      return null;
    const frame = parseInspectionFrame(input.frame);
    return frame
      ? Object.freeze({
          type: 'tplane:runtime-inspection',
          version: RUNTIME_INSPECTION_VERSION,
          nonce: input.nonce,
          generation: input.generation as number,
          frame,
        })
      : null;
  } catch {
    return null;
  }
}

// Module lifetime matches the page, including recorder replacement on remount.
let sequence = 0;
let callSequence = 0;

export function createInspectionRecorder(
  framework: InspectionFrame['framework'],
  publish: (frame: InspectionFrame) => void
): InspectionRecorder {
  const startedAt = performance.now();
  let disposed = false;
  let limited = false;
  let messages: InspectionMessage[] = [];
  let state: InspectionState | null = null;
  let busy = false;
  let calls: InspectionCall[] = [];

  const boundedText = (
    value: unknown,
    maximum: number = INSPECTION_LIMITS.textLength
  ): string => {
    if (typeof value !== 'string') {
      limited = true;
      return '';
    }
    if (value.length > maximum) limited = true;
    return value.slice(0, maximum);
  };

  const snapshotState = (value: unknown): InspectionState | null => {
    if (value === null || value === undefined) return null;
    const input = record(value);
    if (!input) {
      limited = true;
      return null;
    }
    const output: Record<string, InspectionScalar> = Object.create(null);
    let count = 0;
    for (const key of Reflect.ownKeys(input)) {
      if (
        !label(key) ||
        privateKey.test(key) ||
        count >= INSPECTION_LIMITS.scalarKeys
      ) {
        limited = true;
        continue;
      }
      const item = data(input, key);
      if (typeof item === 'string') output[key] = boundedText(item);
      else if (scalar(item)) output[key] = item;
      else {
        limited = true;
        continue;
      }
      count++;
    }
    return Object.freeze(output);
  };

  const emit = (type: string, payload: InspectionState | null = null) => {
    const output = {
      sequence: ++sequence,
      elapsedMs: Math.max(0, performance.now() - startedAt),
      framework,
      messages: [...messages],
      state,
      busy,
      calls: [...calls],
      event: { type, payload },
      limited,
    };
    // Escaping and multibyte text count toward the byte budget, too.
    while (encodedSize(output) > INSPECTION_LIMITS.encodedBytes) {
      output.limited = true;
      if (output.messages.length) output.messages.shift();
      else if (output.calls.length) output.calls.shift();
      else if (output.state !== null) output.state = null;
      else output.event.payload = null;
    }
    const detached = parseInspectionFrame(output);
    if (detached) publish(detached);
  };

  // Inspection must never change the application's control flow.
  const safely = (action: () => void) => {
    if (disposed) return;
    try {
      action();
    } catch {
      /* Untrusted snapshots and observers are isolated. */
    }
  };

  return {
    observe(snapshot, event) {
      safely(() => {
        const input = record(snapshot);
        if (!input) return;
        const rawMessages = data(input, 'messages');
        const nextMessages: InspectionMessage[] = [];
        if (Array.isArray(rawMessages)) {
          const length = data(rawMessages, 'length') as number;
          if (length > INSPECTION_LIMITS.messages) limited = true;
          for (
            let i = Math.max(0, length - INSPECTION_LIMITS.messages);
            i < length;
            i++
          ) {
            const raw = record(data(rawMessages, String(i)));
            if (!raw) {
              limited = true;
              continue;
            }
            const id = boundedText(
              data(raw, 'id'),
              INSPECTION_LIMITS.labelLength
            );
            const role = boundedText(
              data(raw, 'role'),
              INSPECTION_LIMITS.labelLength
            );
            if (!id.trim() || !role.trim()) {
              limited = true;
              continue;
            }
            nextMessages.push({
              id,
              role,
              text: boundedText(data(raw, 'text')),
            });
          }
        } else limited = true;
        messages = nextMessages;
        state = snapshotState(data(input, 'state'));
        busy = data(input, 'busy') === true;
        const rawEvent = record(event);
        const type = rawEvent
          ? boundedText(data(rawEvent, 'type'), INSPECTION_LIMITS.labelLength)
          : 'snapshot';
        emit(
          type.trim() ? type : 'snapshot',
          rawEvent ? snapshotState(data(rawEvent, 'payload')) : null
        );
      });
    },
    startCall(message) {
      let id: string | null = null;
      safely(() => {
        id = `submit-${++callSequence}`;
        calls.push({
          id,
          name: 'submit',
          input: { message: boundedText(message) },
          status: 'pending',
        });
        if (calls.length > INSPECTION_LIMITS.calls) {
          calls.shift();
          limited = true;
        }
        emit('call-started');
      });
      return id;
    },
    settleCall(id, status) {
      safely(() => {
        if (status !== 'settled' && status !== 'rejected') return;
        const index = calls.findIndex(
          (call) => call.id === id && call.status === 'pending'
        );
        if (index === -1) return;
        calls[index] = { ...calls[index], status };
        emit(status === 'settled' ? 'call-settled' : 'call-rejected');
      });
    },
    reset() {
      safely(() => {
        messages = [];
        state = null;
        busy = false;
        calls = [];
        limited = false;
        emit('reset');
      });
    },
    dispose() {
      disposed = true;
      messages = [];
      state = null;
      calls = [];
    },
  };
}
