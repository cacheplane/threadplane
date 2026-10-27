import { describe, expect, it } from 'vitest';
import {
  DEBUG_OWNED_BYTES,
  DEBUG_VIEW_BYTES,
  projectDebugValue,
} from './bounded-value';

function ready(
  value: unknown,
  bytes?: typeof DEBUG_VIEW_BYTES | typeof DEBUG_OWNED_BYTES
) {
  const result = projectDebugValue(value, bytes);
  expect(result.status).toBe('ready');
  if (result.status !== 'ready') throw new Error('Expected ready projection');
  expect(new TextEncoder().encode(result.text).length).toBeLessThanOrEqual(
    bytes ?? DEBUG_VIEW_BYTES
  );
  JSON.parse(result.text);
  return result;
}
describe('bounded debug projection', () => {
  it('preserves observed empty, scalar and null-prototype JSON without invoking toJSON', () => {
    expect(ready({}).text).toBe('{}');
    expect(ready(null).text).toBe('null');
    expect(ready(Object.assign(Object.create(null), { a: 3 })).text).toBe(
      '{"a":3}'
    );
    const value = {
      a: true,
      toJSON() {
        throw new Error('must not execute');
      },
    };
    expect(projectDebugValue(value).status).toBe('unavailable');
  });
  it('limits deep structures and total entries', () => {
    let value: unknown = 'leaf';
    for (let i = 0; i < 30; i++) value = { child: value };
    expect(ready(value).truncated).toBe(true);
    expect(ready(value).text).toBe(
      '{"child":{"child":{"child":{"child":{"child":{"child":null}}}}}}'
    );
    const many = ready(Array.from({ length: 100_000 }, (_, i) => i));
    expect(JSON.parse(many.text)).toHaveLength(200);
    expect(many.truncated).toBe(true);
    const object = Object.fromEntries(
      Array.from({ length: 1000 }, (_, i) => [`key${i}`, i])
    );
    expect(Object.keys(JSON.parse(ready(object).text))).toHaveLength(200);
  });
  it('limits strings by Unicode code points and bounds enormous keys', () => {
    const text = ready('😀'.repeat(10_000));
    expect([...JSON.parse(text.text)]).toHaveLength(2000);
    expect(text.truncated).toBe(true);
    const key = ready({ ['x'.repeat(1_000_000)]: 1 });
    expect(key.truncated).toBe(true);
    expect(key.text).toBe('{}');
  });
  it('counts escaping, UTF-8 and closing delimiters at the byte boundary', () => {
    const data = Array.from({ length: 200 }, () => '\u0000"\\😀'.repeat(500));
    for (const bytes of [DEBUG_VIEW_BYTES, DEBUG_OWNED_BYTES] as const) {
      const result = ready(data, bytes);
      expect(result.truncated).toBe(true);
      expect(result.text.endsWith(']')).toBe(true);
    }
    const escaped = '"\\\n\u0000é😀';
    expect(JSON.parse(ready({ escaped }).text)).toEqual({ escaped });
    expect(JSON.parse(ready({ [escaped]: escaped }).text)).toEqual({
      [escaped]: escaped,
    });
    // Exactly 32 KiB, then one additional source byte: both closures still fit.
    const exact = [
      ...Array.from({ length: 16 }, () => 'x'.repeat(2000)),
      'y'.repeat(716),
    ];
    expect(new TextEncoder().encode(ready(exact).text)).toHaveLength(
      DEBUG_VIEW_BYTES
    );
    expect(ready(exact).truncated).toBe(false);
    exact[16] += 'y';
    expect(new TextEncoder().encode(ready(exact).text)).toHaveLength(
      DEBUG_VIEW_BYTES
    );
    expect(ready(exact).reason).toBe('bytes');
  });
  it('keeps app capture separate from the smaller view/copy budget', () => {
    const data = Array.from({ length: 100 }, () => 'x'.repeat(1500));
    expect(ready(data, DEBUG_OWNED_BYTES).text.length).toBeGreaterThan(
      ready(data).text.length
    );
  });
  it('rejects getters, classes, cycles and non-JSON values without executing code', () => {
    let calls = 0;
    const getter = {
      get secret() {
        calls++;
        return 1;
      },
    };
    const cycle: Record<string, unknown> = {};
    cycle['self'] = cycle;
    for (const value of [
      getter,
      cycle,
      new Date(),
      NaN,
      Infinity,
      undefined,
      1n,
      () => 1,
      { x: undefined },
      // eslint-disable-next-line no-sparse-arrays -- Intentional adversarial input: holes are invalid JSON data.
      [, 1],
    ]) {
      expect(projectDebugValue(value)).toEqual({
        status: 'unavailable',
        text: null,
        truncated: false,
        reason: 'invalid',
      });
    }
    expect(calls).toBe(0);
    const toJSON = Object.defineProperty({}, 'toJSON', {
      enumerable: true,
      get() {
        calls++;
        throw new Error('must not execute');
      },
    });
    expect(projectDebugValue(toJSON).status).toBe('unavailable');
    expect(calls).toBe(0);
  });
});
