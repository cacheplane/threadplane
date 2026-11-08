/** Shared Angular/React conformance data. Execution status is never mutated. */
export const phases = [
  { phase: 'pending', outcome: 'success', expected: 'pending' },
  { phase: 'running', outcome: 'success', expected: 'unknown' },
  { phase: 'running', outcome: 'aborted', expected: 'stopped' },
  { phase: 'pending', outcome: 'aborted', expected: 'stopped' },
  { phase: 'running', outcome: 'interrupted', expected: 'unknown' },
  { phase: 'running', outcome: 'error', expected: 'unknown' },
  { phase: 'pending', outcome: 'paused', expected: 'waiting' },
  { phase: 'complete', outcome: 'aborted', expected: 'complete' },
  { phase: 'error', outcome: 'aborted', expected: 'error' },
] as const;
