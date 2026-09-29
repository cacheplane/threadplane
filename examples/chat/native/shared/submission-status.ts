import type { CompleteOutcome } from '@threadplane/core';
import type { ApplicationSnapshot } from './application.js';

const outcomes: Record<CompleteOutcome, string> = {
  success: 'Response complete.',
  error: 'The response failed.',
  aborted: 'Response stopped locally. The server may still be running.',
  interrupted: 'Response interrupted before completion.',
  paused: 'Response paused.',
};

/** Presentation only: completion describes a response, not its graph effects. */
export function submissionStatus(
  snapshot: Pick<ApplicationSnapshot, 'submission' | 'submissionKind'>
): string {
  const { active, outcome } = snapshot.submission;
  if (active)
    return snapshot.submissionKind === 'decision'
      ? 'Sending decision…'
      : 'Response in progress…';
  if (!outcome) return '';
  if (snapshot.submissionKind === 'decision') {
    if (outcome === 'success') return 'Decision response complete.';
    if (outcome !== 'paused')
      return 'Decision completion could not be confirmed. The server may still be running.';
  }
  return outcomes[outcome];
}
