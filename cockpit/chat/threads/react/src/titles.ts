import { copyData } from './authority';
/** Decode optional presentation metadata without granting conversation authority. */
export function decodeTitle(
  input: unknown,
  threadId: string
): string | undefined {
  try {
    const data = copyData(input) as {
      thread_id?: unknown;
      metadata?: { title?: unknown };
    };
    if (
      !threadId ||
      data?.thread_id !== threadId ||
      typeof data.metadata?.title !== 'string'
    )
      return undefined;
    const title = data.metadata.title.trim();
    return title ? Array.from(title).slice(0, 80).join('') : undefined;
  } catch {
    return undefined;
  }
}
