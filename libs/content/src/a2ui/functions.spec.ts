import { describe, expect, it } from 'vitest';
import { createA2uiSurfaces, resolveA2uiValue, type A2uiSurfaces, type A2uiValue } from './index';

type Message = Parameters<A2uiSurfaces['apply']>[0];
function surface(data: unknown) {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Text', text: 'x' }] } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces.getSnapshot().surfaces[0];
}
const model = {
  guest: { name: 'Ada', 'a/b': 'slash' },
  total: 1234.5,
  count: 1,
  when: '2026-03-07T14:05:09',
  tags: ['vip', 'late'],
};
const at = surface(model);
const run = (value: unknown) => resolveA2uiValue(at, value as A2uiValue);
const call = (name: string, args: Record<string, unknown>) => run({ call: name, args });

describe('resolveA2uiValue', () => {
  it('keeps literals, reads paths and resolves lists item by item', () => {
    expect(run('text')).toBe('text');
    expect(run(3)).toBe(3);
    expect(run(null)).toBeNull();
    expect(run({ path: '/guest/name' })).toBe('Ada');
    expect(run({ path: 'guest/name' })).toBe('Ada');
    expect(run({ path: '/guest/a~1b' })).toBe('slash');
    expect(run({ path: '/tags/1' })).toBe('late');
    expect(run({ path: '/nope/x' })).toBeUndefined();
    expect(run({ path: '/guest/__proto__' })).toBeUndefined();
    expect(run([{ path: '/count' }, 'x'])).toEqual([1, 'x']);
    const plain = { label: 'kept' };
    expect(run(plain)).toBe(plain);
  });

  it('gives undefined for an unknown function, including inherited names', () => {
    expect(call('launch', {})).toBeUndefined();
    expect(call('toString', {})).toBeUndefined();
    expect(call('constructor', {})).toBeUndefined();
  });

  it('interpolates paths, literals and nested calls in formatString', () => {
    expect(call('formatString', { value: 'Hi ${/guest/name}, ${count} of ${/nope}!' })).toBe('Hi Ada, 1 of !');
    expect(call('formatString', { value: { path: '/guest/name' } })).toBe('Ada');
    expect(call('formatString', { value: "${'quoted }'} ${true} ${42}" })).toBe('quoted } true 42');
    expect(call('formatString', { value: 'Cost \\${/total} and ${/total' })).toBe('Cost ${/total} and ${/total');
    expect(call('formatString', { value: "${pluralize(value:${/count}, one:'night', other:'nights')}" })).toBe('night');
    expect(call('formatString', { value: "${formatDate(value:${/when}, format:'yyyy')}-${unknown(a:1)}" })).toBe('2026-');
    expect(call('formatString', { value: 7 })).toBeUndefined();
  });

  it('stops a formatString that nests without end', () => {
    const deep = '${'.repeat(200) + '/count' + '}'.repeat(200);
    expect(call('formatString', { value: deep })).toBe('');
  });

  it('formats numbers and currency in the viewer locale', () => {
    const plain = (options?: Intl.NumberFormatOptions) => new Intl.NumberFormat(undefined, options).format(1234.5);
    expect(call('formatNumber', { value: { path: '/total' } })).toBe(plain());
    expect(call('formatNumber', { value: '1234.5', decimals: 2, grouping: false })).toBe(
      plain({ minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: false })
    );
    expect(call('formatCurrency', { value: { path: '/total' }, currency: 'USD' })).toBe(
      plain({ style: 'currency', currency: 'USD' })
    );
    expect(call('formatNumber', { value: 'many' })).toBeUndefined();
    expect(call('formatNumber', { value: 1, decimals: 500 })).toBeUndefined();
    expect(call('formatCurrency', { value: 1 })).toBeUndefined();
    expect(call('formatCurrency', { value: 1, currency: 'not a code' })).toBeUndefined();
  });

  it('formats a date by pattern in local time', () => {
    expect(call('formatDate', { value: { path: '/when' }, format: 'yyyy-MM-dd HH:mm:ss' })).toBe('2026-03-07 14:05:09');
    expect(call('formatDate', { value: { path: '/when' }, format: 'EEEE, MMMM d, yy h:mm a' })).toBe('Saturday, March 7, 26 2:05 PM');
    expect(call('formatDate', { value: { path: '/when' }, format: 'E MMM M/d H:m:s hh' })).toBe('Sat Mar 3/7 14:5:9 02');
    expect(call('formatDate', { value: new Date(2026, 0, 2).getTime(), format: 'dd.MM.yyyy' })).toBe('02.01.2026');
    expect(call('formatDate', { value: 'soon', format: 'yyyy' })).toBeUndefined();
    expect(call('formatDate', { value: { path: '/when' } })).toBeUndefined();
    expect(call('formatDate', { value: true, format: 'yyyy' })).toBeUndefined();
  });

  it('picks a plural form, preferring an authored zero', () => {
    const forms = { zero: 'none', one: 'night', other: { path: '/guest/name' } };
    expect(call('pluralize', { value: 0, ...forms })).toBe('none');
    expect(call('pluralize', { value: 1, ...forms })).toBe('night');
    expect(call('pluralize', { value: 3, ...forms })).toBe('Ada');
    expect(call('pluralize', { value: 0, other: 'nights' })).toBe('nights');
    expect(call('pluralize', { value: 'x', other: 'nights' })).toBeUndefined();
    expect(call('pluralize', { value: 2, one: 'night' })).toBeUndefined();
  });

  it('runs the logic and validator functions on resolved arguments', () => {
    expect(call('and', { values: [true, { call: 'required', args: { value: { path: '/guest/name' } } }] })).toBe(true);
    expect(call('or', { values: [false, { path: '/nope' }] })).toBe(false);
    expect(call('not', { value: { call: 'email', args: { value: 'a@b.co' } } })).toBe(false);
    expect(call('length', { value: { path: '/guest/name' }, min: 4 })).toBe(false);
    expect(call('numeric', { value: { path: '/total' }, max: 2000 })).toBe(true);
    expect(call('regex', { value: 'vip', pattern: '^v' })).toBe(true);
  });

  it('returns frozen lists', () => {
    expect(Object.isFrozen(run([1, { path: '/count' }]))).toBe(true);
  });
});
