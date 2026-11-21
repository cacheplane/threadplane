import { InjectionToken, computed, signal } from '@angular/core';

/** One answered approval, kept as a one-line record in the transcript. */
export interface ChatApprovalRecord {
  readonly id: number;
  readonly verdict: 'approved' | 'declined';
  /** What was approved, such as "Save note". Empty when the app named nothing. */
  readonly label: string;
  /** The assistant message the approval followed; the record renders after it. */
  readonly afterMessageId: string | undefined;
}

/**
 * Session-only store of answered inline approvals. `<chat>` provides one so a
 * projected `chat-approval-card` can leave a record once its panel goes away.
 * Records are not persisted: a reload or a thread switch starts clean.
 */
export class ChatApprovalRecords {
  private nextId = 0;
  private readonly list = signal<readonly ChatApprovalRecord[]>([]);
  readonly records = this.list.asReadonly();

  add(record: Omit<ChatApprovalRecord, 'id'>): void {
    this.list.update((all) => [...all, { ...record, id: this.nextId++ }]);
  }

  private readonly open = signal<ReadonlySet<object>>(new Set());
  /** True while an inline approval card in this chat waits for an answer. */
  readonly waiting = computed(() => this.open().size > 0);

  /** A card reports whether it currently shows an unanswered inline approval. */
  setWaiting(card: object, waiting: boolean): void {
    const open = this.open();
    if (open.has(card) === waiting) return;
    const next = new Set(open);
    if (waiting) next.add(card);
    else next.delete(card);
    this.open.set(next);
  }
}

export const CHAT_APPROVAL_RECORDS = new InjectionToken<ChatApprovalRecords>('CHAT_APPROVAL_RECORDS');

/** "Approved: Save note", or "Approved" when no label was named. */
export function approvalRecordText(record: Pick<ChatApprovalRecord, 'verdict' | 'label'>): string {
  const verb = record.verdict === 'approved' ? 'Approved' : 'Declined';
  return record.label ? `${verb}: ${record.label}` : verb;
}
