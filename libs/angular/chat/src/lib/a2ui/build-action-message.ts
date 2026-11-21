import { A2UI_WIRE_VERSION } from '@threadplane/a2ui';
import type { A2uiSurface, A2uiActionMessage } from '@threadplane/a2ui';

/**
 * Derive a human-readable label for an outgoing action by walking from
 * the source component to its authored visible text. Today supported:
 * Button → child Text → text. Returns null for other component types or
 * when the linkage isn't well-formed; callers fall back to a camelCase
 * humanization of `action.name`.
 *
 * Why: the chat-lib used to ship a hardcoded `KNOWN_LABELS` map
 * (bookingSubmit → 'Search flights') that embedded app-specific
 * knowledge in the primitive. The LLM that authors a surface already
 * writes the Button's visible text — reuse it as the action label.
 * See spec 2026-05-19-llm-generated-labels-design.md.
 */
function deriveActionLabel(surface: A2uiSurface, sourceId: string): string | null {
  const source = surface.components.get(sourceId);
  if (!source || source.component !== 'Button') return null;
  const childId = (source as { child?: unknown }).child;
  if (typeof childId !== 'string') return null;
  const labelText = surface.components.get(childId);
  if (!labelText || labelText.component !== 'Text') return null;
  // v0.9 dynamic strings are bare literals or `{ path }` bindings; only a
  // bare literal is a usable authored label.
  const text = (labelText as { text?: unknown }).text;
  if (typeof text === 'string') {
    return text.length > 0 ? text : null;
  }
  return null;
}

/** Builds a v0.9 A2uiActionMessage from handler params and the current
 *  surface. The action.context is the resolved plain object the renderer
 *  produced from the component's `action.event.context`. Sets action.label
 *  when the source component is a Button with a Text child whose text is a
 *  non-empty bare literal. */
export function buildA2uiActionMessage(
  params: Record<string, unknown>,
  surface: A2uiSurface,
): A2uiActionMessage {
  const context = (params['context'] as Record<string, unknown>) ?? {};
  const sourceComponentId = params['sourceComponentId'] as string;

  const message: A2uiActionMessage = {
    version: A2UI_WIRE_VERSION,
    action: {
      name: params['name'] as string,
      surfaceId: surface.surfaceId,
      sourceComponentId,
      timestamp: new Date().toISOString(),
      context,
    },
  };

  const label = deriveActionLabel(surface, sourceComponentId);
  if (label) message.action.label = label;

  if (surface.sendDataModel) {
    message.metadata = {
      a2uiClientDataModel: {
        surfaces: { [surface.surfaceId]: surface.dataModel },
      },
    };
  }
  return message;
}
