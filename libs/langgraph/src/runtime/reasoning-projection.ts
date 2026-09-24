import { record } from './wire-message';

/** Supported backend display text only; absence and explicit empty stay distinct. */
export function projectReasoning(
  raw: Record<string, unknown>
): string | undefined {
  const reasoning = raw['reasoning'];
  if (typeof reasoning === 'string') return reasoning;
  const extra = record(raw['additional_kwargs']);
  const supplied = extra?.['reasoning_content'];
  if (typeof supplied === 'string') return supplied;
  const content = raw['content'];
  if (!Array.isArray(content)) return undefined;
  let result: string | undefined;
  for (const value of content) {
    const block = record(value);
    const type = block?.['type'];
    if (!block || (type !== 'reasoning' && type !== 'thinking')) continue;
    result ??= '';
    const text = block['text'];
    if (typeof text === 'string') result += text;
    else if (type === 'thinking') {
      const thinking = block['thinking'];
      if (typeof thinking === 'string') result += thinking;
    }
    const summary = block['summary'];
    if (Array.isArray(summary))
      for (const entry of summary) {
        const text = record(entry)?.['text'];
        if (typeof text === 'string') result += text;
      }
  }
  return result;
}
