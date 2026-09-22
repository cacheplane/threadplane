import { describe, expect, it } from 'vitest';
import {
  completeDelivery,
  projectAgentError,
  staticDelivery,
  streamingDelivery,
} from '../index';

describe('plain agent contracts', () => {
  it('preserves response generation and the existing terminal outcome vocabulary', () => {
    expect(streamingDelivery('run-1')).toEqual({
      generation: 'run-1',
      phase: 'streaming',
    });
    for (const outcome of [
      'success',
      'error',
      'aborted',
      'interrupted',
      'paused',
    ] as const) {
      expect(completeDelivery('run-1', outcome)).toEqual({
        generation: 'run-1',
        phase: 'complete',
        outcome,
      });
    }
    expect(staticDelivery('history-1')).toEqual(
      completeDelivery('history-1', 'success')
    );
  });

  it('projects only classified error display fields into an owned frozen plain value', () => {
    const error = Object.assign(
      new Error('Connection dropped', { cause: { mutable: [] } }),
      {
        kind: 'interrupted' as const,
        status: 503,
        retryable: false,
        recovery: 'check' as const,
        detail: 'The request may still have completed.',
      }
    );
    const projected = projectAgentError(error);
    error.message = 'Changed later';
    expect(projected).toEqual({
      kind: 'interrupted',
      message: 'Connection dropped',
      status: 503,
      retryable: false,
      recovery: 'check',
      detail: 'The request may still have completed.',
    });
    expect(Object.getPrototypeOf(projected)).toBe(Object.prototype);
    expect(Object.isFrozen(projected)).toBe(true);
    expect(projected).not.toHaveProperty('stack');
    expect(projected).not.toHaveProperty('cause');
  });
});
