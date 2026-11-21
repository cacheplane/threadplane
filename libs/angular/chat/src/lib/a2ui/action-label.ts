/**
 * Synthesize a short human-readable label for a serialized A2UI action
 * message, so the chat composition can render "Search flights" instead
 * of a raw `{"version":"v0.9","action":...}` JSON dump as a user bubble.
 *
 * Per the A2UI spec, action messages flow on the client → agent
 * return channel and are framed as typed events (closer to tool calls
 * than user utterances). The spec is silent on chat-bubble rendering;
 * Google's "A2UI in Practice" article and the Stream Chat reference
 * both warn against modeling actions as chat-history user turns.
 *
 * Label source priority:
 *   1. `action.label` if present — populated by `buildA2uiActionMessage`
 *      from the source component's authored visible text (e.g. a
 *      Button's child Text literalString). This is the LLM-authored
 *      label and the preferred source.
 *   2. CamelCase humanization of `action.name` (`bookingSubmit` →
 *      "Booking submit"). Used when no label was stamped — typically
 *      because the source component isn't a Button-with-Text-child.
 *
 * Returns null for any content that isn't an A2UI action message;
 * callers should fall back to the original content in that case.
 *
 * Design context: a previous iteration shipped a hardcoded
 * `KNOWN_LABELS` map (bookingSubmit → 'Search flights') that embedded
 * app-specific knowledge in the chat-lib primitive. That map was
 * removed in favor of derivation from the authored UI; see spec
 * 2026-05-19-llm-generated-labels-design.md.
 *
 * Sources:
 *   - https://a2ui.org/specification/v0.9-a2ui/
 *   - https://medium.com/google-cloud/a2ui-in-practice-patterns-pitfalls-and-the-messages-that-hold-it-together-658720b83789
 *   - https://getstream.io/blog/a2ui-chat-integration/
 */

export function a2uiActionLabel(content: string): string | null {
  if (typeof content !== 'string' || content.length === 0) return null;
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const version = parsed['version'];
  if (typeof version !== 'string' || !version.startsWith('v')) return null;
  const action = parsed['action'];
  if (!isRecord(action)) return null;
  const name = action['name'];
  if (typeof name !== 'string' || name.length === 0) return null;

  // Preferred: label stamped at emit time by buildA2uiActionMessage from
  // the source component's authored visible text.
  const authoredLabel = action['label'];
  if (typeof authoredLabel === 'string' && authoredLabel.length > 0) {
    return authoredLabel;
  }

  // Fallback: humanize the camelCase action name.
  return humanizeCamelCase(name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

/** "bookingSubmit" → "Booking submit". "addToCart" → "Add to cart". */
function humanizeCamelCase(name: string): string {
  const spaced = name.replace(/([a-z])([A-Z])/g, '$1 $2');
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
