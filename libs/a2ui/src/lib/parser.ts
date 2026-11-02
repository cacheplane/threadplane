import { A2UI_WIRE_VERSION, type A2uiMessage } from './types.js';

const ENVELOPE_KEYS = ['createSurface', 'updateComponents', 'updateDataModel', 'deleteSurface'] as const;

/** Stateful JSONL parser that buffers incomplete lines and returns recognized A2UI envelopes from stream chunks. */
export interface A2uiMessageParser {
  /** Push a JSONL stream chunk and return every complete A2UI envelope parsed from it. */
  push(chunk: string): A2uiMessage[];
}

/**
 * Creates a stateful parser for newline-delimited A2UI v0.9 message streams.
 *
 * The parser buffers incomplete lines, skips malformed JSON, and returns only
 * recognized A2UI envelopes: `createSurface`, `updateComponents`,
 * `updateDataModel`, and `deleteSurface`. Unknown envelope keys (e.g. future
 * v1.0 messages) are skipped rather than treated as errors. A missing
 * `version` field defaults to `v0.9`.
 *
 * @example
 * ```ts
 * const parser = createA2uiMessageParser();
 * const messages = parser.push(
 *   '{"version":"v0.9","createSurface":{"surfaceId":"s1","catalogId":"basic"}}\n',
 * );
 * ```
 */
export function createA2uiMessageParser(): A2uiMessageParser {
  let buffer = '';

  function parseEnvelope(json: Record<string, unknown>): A2uiMessage | null {
    for (const key of ENVELOPE_KEYS) {
      if (key in json && typeof json[key] === 'object' && json[key] !== null) {
        const version = typeof json['version'] === 'string' ? json['version'] : A2UI_WIRE_VERSION;
        // A2uiMessage is a discriminated union of single-envelope-key objects.
        return { version, [key]: json[key] } as unknown as A2uiMessage;
      }
    }
    return null;
  }

  function push(chunk: string): A2uiMessage[] {
    buffer += chunk;
    const messages: A2uiMessage[] = [];

    let newlineIndex: number;
    while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;

      try {
        const json = JSON.parse(line);
        if (json && typeof json === 'object' && !Array.isArray(json)) {
          const msg = parseEnvelope(json as Record<string, unknown>);
          if (msg) messages.push(msg);
        }
      } catch {
        // Skip malformed lines silently — partial JSONL is normal mid-stream.
      }
    }

    return messages;
  }

  return { push };
}
