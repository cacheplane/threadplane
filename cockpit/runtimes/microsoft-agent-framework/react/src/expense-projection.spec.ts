import { expect, it } from 'vitest';
import { projectExpense } from './expense-projection';
it('displays partial prediction without supplying approval authority', () => {
  expect(projectExpense({ expense: { vendor: 'Prediction' } })).toEqual({
    vendor: 'Prediction',
  });
  expect(
    Object.isFrozen(projectExpense({ expense: { vendor: 'Prediction' } }))
  ).toBe(true);
});
