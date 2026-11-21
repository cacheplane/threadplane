import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod/v4';
import { action } from './tools';
import { validateArgs, executeFunctionTool } from './execute';

// ── validateArgs ─────────────────────────────────────────────────────────────

describe('validateArgs()', () => {
  const citySchema = z.object({ city: z.string() });

  it('resolves ok:true with the coerced value on valid input', async () => {
    const result = await validateArgs(citySchema, { city: 'SF' });
    expect(result).toEqual({ ok: true, value: { city: 'SF' } });
  });

  it('resolves ok:false with a non-empty error on invalid input', async () => {
    const result = await validateArgs(citySchema, { city: 123 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.length).toBeGreaterThan(0);
    }
  });
});

// ── executeFunctionTool ───────────────────────────────────────────────────────

describe('executeFunctionTool()', () => {
  it('resolves ok:true with the handler return value on valid args', async () => {
    const def = action('get temp', z.object({ city: z.string() }), async (a) => ({
      temp: 72,
      city: a.city,
    }));
    const result = await executeFunctionTool(def, { city: 'NYC' });
    expect(result).toEqual({ ok: true, value: { temp: 72, city: 'NYC' } });
  });

  it('resolves ok:false with the error message when the handler throws', async () => {
    const def = action('boom', z.object({ x: z.string() }), async () => {
      throw new Error('handler exploded');
    });
    const result = await executeFunctionTool(def, { x: 'hi' });
    expect(result).toEqual({ ok: false, error: 'handler exploded' });
  });

  it('resolves ok:false with "invalid arguments" prefix on invalid args and does NOT call the handler', async () => {
    const handlerSpy = vi.fn().mockResolvedValue('should not be called');
    const def = action('typed_tool', z.object({ city: z.string() }), handlerSpy);
    const result = await executeFunctionTool(def, { city: 999 });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^invalid arguments/);
    }
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it('passes the handler context signal to the handler', async () => {
    const controller = new AbortController();
    const handler = vi.fn(async (_args: { city: string }, context: { signal: AbortSignal }) => {
      expect(context.signal).toBe(controller.signal);
      return 'ok';
    });
    const def = action('ctx', z.object({ city: z.string() }), handler);

    const result = await executeFunctionTool(def, { city: 'SF' }, { signal: controller.signal });

    expect(result).toEqual({ ok: true, value: 'ok' });
    expect(handler).toHaveBeenCalledOnce();
  });
});
