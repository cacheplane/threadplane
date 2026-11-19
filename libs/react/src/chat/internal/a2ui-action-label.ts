const record = (value: unknown): value is Record<string, unknown> =>
  value != null && typeof value === 'object' && !Array.isArray(value);

/**
 * The words to show for a message whose content is a serialized A2UI action
 * (`{"version":"v0.9","action":{…}}`): the pressed control's own label, or the
 * action name in plain words ("bookingSubmit" reads "Booking submit"). Null
 * for any other content.
 */
export function a2uiActionLabel(content: string): string | null {
  const trimmed = content.trimStart();
  if (!trimmed.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!record(parsed)) return null;
  const version = parsed['version'];
  if (typeof version !== 'string' || !version.startsWith('v')) return null;
  const action = parsed['action'];
  if (!record(action)) return null;
  const name = action['name'];
  if (typeof name !== 'string' || name === '') return null;
  const label = action['label'];
  if (typeof label === 'string' && label !== '') return label;
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
