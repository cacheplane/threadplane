import type { ReactRenderFunctions } from '@threadplane/react/render';

/** Pure synchronous calculations; locale formatting follows the viewer's browser. */
export const localFunctions: ReactRenderFunctions = Object.freeze({
  uppercase: ({ value }) =>
    typeof value === 'string' ? value.toUpperCase() : undefined,
  reverse: ({ value }) =>
    typeof value === 'string' ? value.split('').reverse().join('') : undefined,
  multiply: ({ a, b }) =>
    typeof a === 'number' && typeof b === 'number' ? a * b : undefined,
  formatDate: ({ value }) => {
    if (typeof value !== 'string') return undefined;
    const date = new Date(value);
    return Number.isFinite(date.getTime())
      ? date.toLocaleDateString()
      : undefined;
  },
});
