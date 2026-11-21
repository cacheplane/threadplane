import { describe, expect, it } from 'vitest';
import { z } from 'zod/v4';
import {
  clientToolGuardFailureResult,
  defaultInterruptedClientToolResult,
  shouldClaimBeforeExecute,
} from './client-tool-execution-guard';
import { action } from './tools';

describe('client tool execution guard helpers', () => {
  it('marks action tools idempotent when requested', () => {
    const tool = action('Read cached data', z.object({}), async () => 'cached', {
      idempotent: true,
    });

    expect(tool.idempotent).toBe(true);
    expect(shouldClaimBeforeExecute(tool)).toBe(false);
  });

  it('claims before executing function tools by default', () => {
    const tool = action('Charge a card', z.object({}), async () => 'charged');

    expect(tool.idempotent).toBeUndefined();
    expect(shouldClaimBeforeExecute(tool)).toBe(true);
  });

  it('creates an interrupted error result for stale executions', () => {
    const result = defaultInterruptedClientToolResult('call-1');

    expect(result.ok).toBe(false);
    expect(result.error).toContain('call-1');
    expect(result.error).toContain('interrupted');
  });

  it('creates a guard failure error result', () => {
    const result = clientToolGuardFailureResult('call-2', new Error('store unavailable'));

    expect(result.ok).toBe(false);
    expect(result.error).toContain('call-2');
    expect(result.error).toContain('guard failed');
    expect(result.error).toContain('store unavailable');
  });
});
