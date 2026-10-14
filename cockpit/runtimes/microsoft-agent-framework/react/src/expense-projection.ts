import { ownData, record, validAmount, type Expense } from './approval-policy';
export type ExpenseDraft = Readonly<Partial<Expense>>;
/** Shared state is predictive display only, including when contributed by a child. */
export function projectExpense(state: unknown): ExpenseDraft | undefined {
  try {
    const e = record(record(ownData(state))?.['expense']);
    if (!e) return;
    const draft: Partial<{ -readonly [K in keyof Expense]: Expense[K] }> = {};
    for (const key of ['vendor', 'category', 'memo'] as const)
      if (
        typeof e[key] === 'string' &&
        e[key].length <= (key === 'memo' ? 4000 : 500)
      )
        draft[key] = e[key];
    if (validAmount(e['amount_usd'])) draft.amount_usd = e['amount_usd'];
    return Object.freeze(draft);
  } catch {
    return undefined;
  }
}
