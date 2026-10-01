import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../agent/tool-call';
import { selectPendingClientToolCalls } from './select-pending-client-tool-calls';

const weatherCall: ToolCall = {
  id: 'c1',
  name: 'get_weather',
  args: {},
  status: 'complete',
};

const stockCall: ToolCall = {
  id: 'c2',
  name: 'get_stock_price',
  args: {},
  status: 'complete',
};

function select(overrides: Partial<Parameters<typeof selectPendingClientToolCalls>[0]> = {}) {
  return selectPendingClientToolCalls({
    isLoading: false,
    toolCalls: [weatherCall],
    catalogNames: new Set(['get_weather']),
    resolvedIds: new Set(),
    ...overrides,
  });
}

describe('selectPendingClientToolCalls', () => {
  it('returns [] while the agent is loading', () => {
    expect(select({ isLoading: true })).toEqual([]);
  });

  it('includes catalog tool calls with no result that were not resolved locally', () => {
    const pending = select();

    expect(pending).toEqual([weatherCall]);
    expect(pending[0]).toBe(weatherCall);
  });

  it('excludes tool calls whose name is not in the catalog', () => {
    expect(select({ catalogNames: new Set(['other_tool']) })).toEqual([]);
  });

  it('excludes tool calls that already have a server result', () => {
    expect(select({
      toolCalls: [{ ...weatherCall, result: { temp: 72 } }],
    })).toEqual([]);
  });

  it('excludes tool calls that were resolved locally', () => {
    expect(select({ resolvedIds: new Set(['c1']) })).toEqual([]);
  });

  it('returns multiple matching calls in source order', () => {
    expect(select({
      toolCalls: [weatherCall, stockCall],
      catalogNames: new Set(['get_weather', 'get_stock_price']),
    })).toEqual([weatherCall, stockCall]);
  });

  it('uses the producer-declared pending set when one is present', () => {
    // stockCall is in the catalog but the producer did not name it pending.
    const out = select({
      toolCalls: [weatherCall, stockCall],
      catalogNames: new Set(['get_weather', 'get_stock_price']),
      authoritativeIds: new Set(['c1']),
    });
    expect(out.map((tc) => tc.id)).toEqual(['c1']);
  });

  it('still hides resolved calls and non-catalog calls under an authoritative set', () => {
    const out = select({
      toolCalls: [weatherCall, stockCall],
      catalogNames: new Set(['get_weather']),
      authoritativeIds: new Set(['c1', 'c2']),
      resolvedIds: new Set(['c1']),
    });
    expect(out).toEqual([]);
  });
});
