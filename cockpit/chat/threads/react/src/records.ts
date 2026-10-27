import { copyData, messageKey, type Canonical } from './authority';
export interface ConversationRecord {
  readonly key: string;
  readonly ordinal: number;
  readonly threadId: string | null;
  readonly label: string;
  readonly title?: string;
  readonly draft: string;
  readonly availability: 'available' | 'unavailable';
  readonly canonical: Canonical | null;
  readonly generations: readonly string[];
  readonly version: number;
}
/** Retains plain page-local records without keeping session or content owners alive. */
export class ConversationRecords {
  private readonly records = new Map<string, ConversationRecord>();
  private serial = 0;
  private require(key: string): ConversationRecord {
    const record = this.records.get(key);
    if (!record) throw new Error('Unknown conversation');
    return record;
  }
  private update(
    key: string,
    patch: Partial<ConversationRecord>
  ): ConversationRecord {
    const record = Object.freeze({ ...this.require(key), ...patch });
    this.records.set(key, record);
    return record;
  }
  /** Begin a blank local view while preserving every confirmed conversation. */
  create(): ConversationRecord {
    for (const [key, record] of this.records)
      if (!record.threadId) this.records.delete(key);
    const ordinal = ++this.serial;
    const record: ConversationRecord = Object.freeze({
      key: 'local-' + ordinal,
      ordinal,
      threadId: null,
      label: 'Conversation ' + ordinal,
      draft: '',
      availability: 'available',
      canonical: null,
      generations: Object.freeze([]),
      version: 0,
    });
    this.records.set(record.key, record);
    return record;
  }
  /** Look up only a key already owned by this page. */
  get(key: string): ConversationRecord | undefined {
    return this.records.get(key);
  }
  /** Return an immutable view of the page's local records. */
  list(): readonly ConversationRecord[] {
    return Object.freeze([...this.records.values()]);
  }
  /** Attach a confirmed remote ID without changing the record or draft identity. */
  confirmThread(key: string, id: string): void {
    const record = this.require(key);
    if (
      record.availability !== 'available' ||
      typeof id !== 'string' ||
      !id.trim() ||
      (record.threadId && record.threadId !== id) ||
      [...this.records.values()].some(
        (other) => other.key !== key && other.threadId === id
      )
    )
      throw new Error('Unconfirmed conversation');
    this.update(key, { threadId: id });
  }
  /** Retain draft text separately from canonical conversation evidence. */
  setDraft(key: string, draft: string): void {
    if (typeof draft !== 'string') throw new Error('Invalid draft');
    this.update(key, { draft });
  }
  /** Store a validated fresh turn that extends the previously confirmed prefix. */
  confirm(key: string, input: Canonical, generation: string): void {
    const canonical = copyData(input) as Canonical;
    const record = this.require(key),
      previous = record.canonical;
    if (
      record.availability !== 'available' ||
      !record.threadId ||
      canonical.threadId !== record.threadId ||
      typeof generation !== 'string' ||
      !generation.trim() ||
      record.generations.includes(generation) ||
      canonical.messages.length !== (previous?.messages.length ?? 0) + 2 ||
      (previous &&
        (previous.checkpoint === canonical.checkpoint ||
          previous.messages.some(
            (m, i) => messageKey(m) !== messageKey(canonical.messages[i])
          )))
    )
      throw new Error('Unconfirmed saved conversation');
    this.update(key, {
      canonical,
      generations: Object.freeze([...record.generations, generation]),
    });
  }
  /** Invalidate optional metadata work without changing conversation authority. */
  invalidate(key: string): number {
    const version = this.require(key).version + 1;
    this.update(key, { version });
    return version;
  }
  /** Apply presentation metadata only to its still-current known record version. */
  setTitle(key: string, title: string, version: number): boolean {
    const record = this.records.get(key);
    if (
      !record?.threadId ||
      record.availability !== 'available' ||
      record.version !== version ||
      typeof title !== 'string' ||
      !title.trim()
    )
      return false;
    this.update(key, { title, label: title });
    return true;
  }
  /** Permanently withhold continuation after uncertain work in this record. */
  markUnavailable(key: string): void {
    const record = this.require(key);
    this.update(key, {
      availability: 'unavailable',
      version: record.version + 1,
    });
  }
}
