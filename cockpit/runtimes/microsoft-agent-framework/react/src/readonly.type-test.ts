import type {
  ExpenseApproval,
  OwnedTurn,
  NativeSnapshot,
} from './approval-policy';
import type { MafSnapshot } from './application';
import type { ExpenseDraft } from './expense-projection';
function readonlyContract(
  view: MafSnapshot,
  approval: ExpenseApproval,
  turn: OwnedTurn,
  native: NativeSnapshot,
  draft: ExpenseDraft
) {
  // @ts-expect-error View generation is owned.
  view.generation = 42;
  // @ts-expect-error Root transcript is readonly.
  view.rows.push(turn.human);
  // @ts-expect-error Captured canonical arguments cannot be edited.
  approval.expense.amount_usd = 1;
  // @ts-expect-error The native occurrence cannot be replaced.
  approval.pause = 'reconstructed';
  // @ts-expect-error Native observation is deeply readonly.
  approval.observation.state.expense = {};
  // @ts-expect-error Prefix is owned.
  turn.prefix.push(turn.human);
  // @ts-expect-error Native transcript is deeply readonly.
  native.transcript[0].id = 'spoof';
  // @ts-expect-error Prediction remains read-only.
  draft.vendor = 'spoof';
}
void readonlyContract;
