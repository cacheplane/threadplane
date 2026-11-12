import { record, resolveA2uiValue } from './functions.js';
import type { A2uiSurfaceSnapshot, A2uiValue } from './types.js';

/** A v0.9 client-to-agent action: which component fired, on which surface, with its context resolved to plain values. */
export interface A2uiActionMessage {
  readonly version: 'v0.9';
  readonly action: {
    readonly name: string;
    readonly surfaceId: string;
    readonly sourceComponentId: string;
    readonly timestamp: string;
    readonly context: { readonly [key: string]: A2uiValue };
    /** The source Button's literal text, when it has one. */
    readonly label?: string;
  };
  /** Present only when the surface was created with `sendDataModel: true`. */
  readonly metadata?: {
    readonly a2uiClientDataModel: {
      readonly surfaces: { readonly [surfaceId: string]: A2uiValue };
    };
  };
}

/**
 * Builds the action message for one component's `action.event`, resolving
 * every context value against the surface's current data model as
 * `resolveA2uiValue` does. Returns null when the component is missing or has
 * no event action. Nothing is sent; the caller transports it.
 */
export function createA2uiActionMessage(
  surface: A2uiSurfaceSnapshot,
  sourceComponentId: string,
  timestamp: string = new Date().toISOString()
): A2uiActionMessage | null {
  const source = surface.components.find((item) => item.id === sourceComponentId);
  const action = source?.['action'];
  const event = record(action) ? action['event'] : undefined;
  if (!source || !record(event) || typeof event['name'] !== 'string') return null;
  const context: Record<string, A2uiValue> = {};
  const authored = event['context'];
  if (record(authored))
    for (const key of Object.keys(authored))
      context[key] = resolveA2uiValue(surface, authored[key]);
  const child = source.component === 'Button' ? source['child'] : undefined;
  const text = surface.components.find(
    (item) => item.id === child && item.component === 'Text'
  )?.['text'];
  return Object.freeze({
    version: 'v0.9',
    action: Object.freeze({
      name: event['name'],
      surfaceId: surface.surfaceId,
      sourceComponentId,
      timestamp,
      context: Object.freeze(context),
      ...(typeof text === 'string' && text !== '' ? { label: text } : {}),
    }),
    ...(surface.sendDataModel === true
      ? {
          metadata: Object.freeze({
            a2uiClientDataModel: Object.freeze({
              surfaces: Object.freeze({ [surface.surfaceId]: surface.dataModel }),
            }),
          }),
        }
      : {}),
  });
}
