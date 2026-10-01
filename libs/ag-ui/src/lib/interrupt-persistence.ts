import { InterruptSchema, MessageSchema, ResumeEntrySchema } from '@ag-ui/core/schemas';
import type { InterruptSessionSnapshot } from './interrupt-session.types';
import type { ThreadSnapshot } from './run-state-transaction';

export interface AgUiThreadRecord {
  version: 1;
  namespace: string;
  threadId: string;
  revision: number;
  committed: ThreadSnapshot;
  session: InterruptSessionSnapshot;
  resumeInput?: ThreadSnapshot;
}
export interface AgUiInterruptPersistence {
  namespace: string;
  store: {
    load(key: string): Promise<AgUiThreadRecord | null>;
    compareAndSwap(key: string, expectedRevision: number | null, next: AgUiThreadRecord): Promise<boolean>;
  };
  reconcile?: (record: AgUiThreadRecord) => Promise<
    { status: 'unknown' } |
    { status: 'pending' | 'acknowledged' | 'completed'; committed: ThreadSnapshot; session: InterruptSessionSnapshot }
  >;
}

export class InterruptPersistence {
  private readonly key: string;
  private readonly namespace: string;
  private record: AgUiThreadRecord | null = null;
  private loaded = false;
  private conflicted = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly config: AgUiInterruptPersistence, private readonly threadId: string) {
    nonempty(config.namespace); nonempty(threadId);
    this.namespace = config.namespace;
    this.key = JSON.stringify([this.namespace, threadId]);
  }

  load(): Promise<AgUiThreadRecord | null> {
    return this.serialize(async () => {
      await this.reload();
      return structuredClone(this.record);
    });
  }

  save(data: Pick<AgUiThreadRecord, 'committed' | 'session' | 'resumeInput'>): Promise<void> {
    // Capture at invocation, before another queued operation can yield to the caller.
    let copy: typeof data;
    try { copy = structuredClone(data); } catch (error) { return Promise.reject(error); }
    return this.serialize(async () => {
      await this.ensureLoaded();
      await this.write(copy);
    });
  }

  reconcile(): Promise<AgUiThreadRecord | null> {
    return this.serialize(async () => {
      await this.reload();
      if (!this.record) return null;
      if (!this.config.reconcile) throw new Error('Interrupt recovery requires authoritative reconciliation');
      const result = await this.config.reconcile(structuredClone(this.record));
      if (result.status === 'unknown') throw new Error('Interrupt recovery requires an authoritative outcome');
      const copy = structuredClone(result);
      validateSession(copy.session);
      const phase = copy.session.phase;
      if ((copy.status === 'pending' && phase !== 'pending') ||
          (copy.status === 'acknowledged' && phase !== 'acknowledged') ||
          (copy.status === 'completed' && phase !== 'none' && phase !== 'pending')) {
        throw new Error('Invalid authoritative interrupt recovery phase');
      }
      if (!['pending', 'acknowledged', 'completed'].includes(copy.status)) throw new Error('Invalid interrupt recovery status');
      if (copy.status === 'completed' && phase === 'pending' &&
          (copy.session.generation <= this.record.session.generation || copy.session.attempt !== undefined)) {
        throw new Error('Completed recovery requires a newly paused interrupt batch');
      }
      const previousAttempt = this.record.session.attempt;
      const attempt = copy.session.attempt;
      const retainedAttempt = attempt && previousAttempt && attempt.id === previousAttempt.id &&
        attempt.runId === previousAttempt.runId && attempt.generation === previousAttempt.generation;
      await this.write({ committed: copy.committed, session: copy.session,
        ...(retainedAttempt && this.record.resumeInput ? { resumeInput: this.record.resumeInput } : {}) });
      return structuredClone(this.record);
    });
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation);
    // Keep the queue usable and attach a rejection handler even if a caller aborts.
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.conflicted) throw new Error('Interrupt persistence conflict: another writer owns this thread');
    if (this.loaded) return;
    await this.reload();
  }

  private async reload(): Promise<void> {
    const value = await this.config.store.load(this.key);
    if (value !== null) {
      this.validate(value);
      const copy = structuredClone(value);
      if (copy.session.phase === 'claimed' || copy.session.phase === 'resuming') copy.session.phase = 'uncertain';
      if (copy.session.phase === 'acknowledged') copy.session.phase = 'recovery-required';
      this.record = copy;
    } else this.record = null;
    this.loaded = true;
    this.conflicted = false;
  }

  private async write(data: Pick<AgUiThreadRecord, 'committed' | 'session' | 'resumeInput'>): Promise<void> {
    const expected = this.record?.revision ?? null;
    const next: AgUiThreadRecord = { ...structuredClone(data), version: 1, namespace: this.namespace,
      threadId: this.threadId, revision: expected === null ? 0 : expected + 1 };
    this.validate(next);
    if (!await this.config.store.compareAndSwap(this.key, expected, structuredClone(next))) {
      this.conflicted = true;
      throw new Error('Interrupt persistence conflict: another writer owns this thread');
    }
    this.record = next;
  }

  private validate(value: AgUiThreadRecord): void {
    if (!isRecord(value) || value.version !== 1 || value.namespace !== this.namespace ||
        value.threadId !== this.threadId || !Number.isSafeInteger(value.revision) || value.revision < 0) {
      throw new Error('Invalid interrupt persistence record identity or revision');
    }
    validateSnapshot(value.committed);
    if (value.resumeInput !== undefined) validateSnapshot(value.resumeInput);
    validateSession(value.session);
  }
}

function validateSnapshot(value: ThreadSnapshot): void {
  if (!isRecord(value) || !isRecord(value.state) || !Array.isArray(value.messages)) throw new Error('Invalid persisted thread snapshot');
  json(value.state);
  for (const message of value.messages) MessageSchema.parse(message);
}

function validateSession(session: InterruptSessionSnapshot): void {
  if (!isRecord(session) || !Number.isSafeInteger(session.generation) || session.generation < 0 ||
      !['none', 'collecting', 'pending', 'claimed', 'resuming', 'acknowledged', 'uncertain', 'recovery-required'].includes(session.phase) ||
      !Array.isArray(session.interrupts)) throw new Error('Invalid persisted interrupt session');
  if (session.runId !== undefined) nonempty(session.runId);
  const ids = new Set<string>();
  for (const entry of session.interrupts) {
    InterruptSchema.parse(entry); nonempty(entry.id);
    if (ids.has(entry.id)) throw new Error('Duplicate persisted interrupt id');
    ids.add(entry.id);
  }
  if (session.legacy !== undefined) {
    if (!isRecord(session.legacy) || typeof session.legacy.resumable !== 'boolean') throw new Error('Invalid persisted legacy interrupt');
    nonempty(session.legacy.id);
  }
  const hasBatch = ids.size > 0 || session.legacy !== undefined;
  if ((session.phase === 'none' && (hasBatch || session.attempt !== undefined)) ||
      (session.phase !== 'none' && (!hasBatch || session.generation === 0))) throw new Error('Invalid persisted interrupt batch');
  if (['claimed', 'resuming', 'acknowledged', 'uncertain', 'recovery-required'].includes(session.phase) && !session.attempt) {
    throw new Error('Persisted interrupt phase requires a correlated attempt');
  }
  const attempt = session.attempt;
  if (!attempt) return;
  if (session.phase === 'collecting' || !isRecord(attempt) || attempt.generation !== session.generation ||
      !isRecord(attempt.input) || attempt.input['resume'] === undefined || !isRecord(attempt.parameters)) throw new Error('Invalid persisted resume attempt');
  nonempty(attempt.id); nonempty(attempt.runId);
  if (attempt.parameters.resume !== undefined) {
    const entries = attempt.parameters.resume;
    if (!Array.isArray(entries) || entries.length !== ids.size || ids.size === 0) throw new Error('Invalid persisted resume batch');
    const responses = new Set<string>();
    for (const entry of entries) {
      ResumeEntrySchema.parse(entry);
      if (!ids.has(entry.interruptId) || responses.has(entry.interruptId) ||
          (entry.status === 'cancelled' && entry.payload !== undefined)) throw new Error('Invalid persisted resume correlation');
      responses.add(entry.interruptId);
    }
  } else {
    const props = attempt.parameters.forwardedProps;
    if (!isRecord(props) || !isRecord(props['command']) || props['command']['resume'] === undefined) throw new Error('Invalid persisted resume command');
  }
}

function nonempty(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error('Interrupt persistence identifiers must be nonempty');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function json(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return;
  if (typeof value !== 'object' || value === null || seen.has(value) ||
      (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) throw new Error('Persisted state must be JSON');
  seen.add(value);
  for (const entry of Object.values(value)) json(entry, seen);
  seen.delete(value);
}
