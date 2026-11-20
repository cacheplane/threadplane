/**
 * Relates the user messages of a recorded run to the ones a live session
 * sends while the recording is replayed.
 *
 * A session names every user message it submits and expects the backend to
 * echo that id: the id is how it tells its own message from one the graph
 * added. A recording carries the ids of the session that recorded it, so a
 * replayed `values` event would show the prompt twice, once as submitted and
 * once as recorded. The replay transports pass everything they answer through
 * `translate`, which renames each recorded user message to the id the
 * replaying session gave the same prompt.
 */
export class ReplayUserIds {
  /** Recorded user message id → the id the replaying session submitted. */
  private readonly ids = new Map<string, string>();

  reset(): void {
    this.ids.clear();
  }

  /**
   * Call once for each replayed run, before its events are answered, with the
   * payload the session sent and the run's recorded events. A run that adds no
   * user message (a resume) relates nothing.
   */
  adopt(payload: unknown, recorded: readonly unknown[]): void {
    const sent = lastHuman((payload as { messages?: unknown } | null)?.messages);
    if (!sent) return;
    // Earlier runs' prompts are already related, so a user message this run
    // carries and nothing has claimed yet is the one this run added. The text
    // settles it when a run carries several.
    const added = humans(recorded).filter((message) => !this.ids.has(message.id));
    const match = added.find((message) => message.text === sent.text) ?? added[0];
    if (match) this.ids.set(match.id, sent.id);
  }

  /** A copy of `value` with every related user message renamed; `value` itself when none is in it. */
  translate<T>(value: T): T {
    return this.ids.size === 0 ? value : (rename(value, this.ids) as T);
  }
}

interface Human {
  readonly id: string;
  readonly text: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isHuman(value: unknown): value is Record<string, unknown> & { id: string } {
  return isRecord(value) && value['type'] === 'human' && typeof value['id'] === 'string';
}

/** A human message's text, whether its content is a string or text blocks. */
function textOf(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((block) => (typeof block === 'string' ? block : isRecord(block) && typeof block['text'] === 'string' ? block['text'] : ''))
    .join('');
}

function lastHuman(messages: unknown): Human | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (isHuman(message)) return { id: message.id, text: textOf(message['content']) };
  }
  return undefined;
}

/** Every distinct human message under `value`, in the order first met. */
function humans(value: unknown, found = new Map<string, Human>()): Human[] {
  if (Array.isArray(value)) {
    for (const item of value) humans(item, found);
  } else if (isRecord(value)) {
    if (isHuman(value) && !found.has(value.id)) {
      found.set(value.id, { id: value.id, text: textOf(value['content']) });
    }
    for (const key of Object.keys(value)) humans(value[key], found);
  }
  return [...found.values()];
}

/** Copy-on-write: a branch with nothing to rename is returned as it is. */
function rename(value: unknown, ids: ReadonlyMap<string, string>): unknown {
  if (Array.isArray(value)) {
    let changed = false;
    const next = value.map((item) => {
      const renamed = rename(item, ids);
      if (renamed !== item) changed = true;
      return renamed;
    });
    return changed ? next : value;
  }
  if (!isRecord(value)) return value;
  let next: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const renamed = rename(value[key], ids);
    if (renamed !== value[key]) (next ??= { ...value })[key] = renamed;
  }
  const to = isHuman(value) ? ids.get(value.id) : undefined;
  if (to !== undefined) (next ??= { ...value })['id'] = to;
  return next ?? value;
}
