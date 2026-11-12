import { describe, expect, it } from 'vitest';
import { createA2uiSurfaces, evaluateA2uiChecks, type A2uiSurfaces } from './index';

type Message = Parameters<A2uiSurfaces['apply']>[0];
function surface(components: readonly Record<string, unknown>[], data: unknown = {}) {
  const surfaces = createA2uiSurfaces();
  for (const message of [
    { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'basic' } },
    { version: 'v0.9', updateComponents: { surfaceId: 's', components } },
    { version: 'v0.9', updateDataModel: { surfaceId: 's', value: data } },
  ])
    surfaces.apply(message as unknown as Message);
  return surfaces.getSnapshot().surfaces[0];
}
const required = (path: string, message = 'Required') => ({
  condition: { call: 'required', args: { value: { path } } },
  message,
});

describe('evaluateA2uiChecks', () => {
  it('returns nothing for a surface with no checks or only passing ones', () => {
    expect(evaluateA2uiChecks(surface([{ id: 'root', component: 'Text', text: 'x' }]))).toEqual([]);
    expect(
      evaluateA2uiChecks(
        surface(
          [{ id: 'root', component: 'TextField', value: { path: '/name' }, checks: [required('/name')] }],
          { name: 'Ada' }
        )
      )
    ).toEqual([]);
  });

  it('reports the first failing rule of each component in component order, with its bound path', () => {
    const failures = evaluateA2uiChecks(
      surface(
        [
          { id: 'root', component: 'Column', children: ['name', 'mail', 'ok'] },
          {
            id: 'name',
            component: 'TextField',
            value: { path: '/name' },
            checks: [
              required('/name'),
              { condition: { call: 'length', args: { value: { path: '/name' }, min: 3 } }, message: 'Too short' },
            ],
          },
          {
            id: 'mail',
            component: 'TextField',
            value: { path: '/mail' },
            checks: [
              required('/mail'),
              { condition: { call: 'email', args: { value: { path: '/mail' } } }, message: 'Not an email' },
            ],
          },
          { id: 'ok', component: 'CheckBox', value: true, checks: [{ condition: true, message: 'never' }] },
        ],
        { name: '', mail: 'ada' }
      )
    );
    expect(failures).toEqual([
      { componentId: 'name', message: 'Required', path: '/name' },
      { componentId: 'mail', message: 'Not an email', path: '/mail' },
    ]);
    expect(Object.isFrozen(failures)).toBe(true);
    expect(Object.isFrozen(failures[0])).toBe(true);
  });

  it('passes only a condition that resolves to true', () => {
    const one = (condition: unknown, data: unknown = {}) =>
      evaluateA2uiChecks(
        surface([{ id: 'root', component: 'CheckBox', value: { path: '/v' }, checks: [{ condition, message: 'no' }] }], data)
      ).length;
    expect(one(true)).toBe(0);
    expect(one({ path: '/v' }, { v: true })).toBe(0);
    for (const condition of [false, 'true', 1, null, { path: '/missing' }, { call: 'unknownFunction', args: {} }])
      expect(one(condition)).toBe(1);
    expect(one({ call: 'and', args: { values: [{ path: '/v' }, { call: 'not', args: { value: false } }] } }, { v: true })).toBe(0);
    expect(one({ call: 'numeric', args: { value: { path: '/v' }, min: 1, max: 8 } }, { v: 9 })).toBe(1);
    expect(one({ call: 'regex', args: { value: { path: '/v' }, pattern: '(' } }, { v: 'x' })).toBe(1);
  });

  it('matches the protocol validators on their edge cases', () => {
    const passes = (call: string, args: Record<string, unknown>, data: unknown = {}) =>
      evaluateA2uiChecks(
        surface([{ id: 'root', component: 'TextField', value: { path: '/v' }, checks: [{ condition: { call, args }, message: 'no' }] }], data)
      ).length === 0;
    const v = { value: { path: '/v' } };
    for (const [value, ok] of [
      ['ada@example.com', true], ['a.b@c.io', true], ['ada', false], ['@example.com', false], ['ada@', false],
      ['ada@example', false], ['a.b@c', false], ['ada@example.', false], ['ada@.com', false], ['a@b@c.io', false],
      ['ada @example.com', false], [7, false],
    ] as const)
      expect([value, passes('email', v, { v: value })]).toEqual([value, ok]);
    for (const [value, ok] of [['x', true], ['', false], [null, false], [[], false], [['a'], true], [0, true], [false, true]] as const)
      expect([value, passes('required', v, { v: value })]).toEqual([value, ok]);
    expect(passes('required', {}, {})).toBe(false);
    expect(passes('length', { ...v, min: 2, max: '4' }, { v: 'abc' })).toBe(true);
    expect(passes('length', { ...v, min: 2 }, { v: 'a' })).toBe(false);
    expect(passes('length', { ...v, max: 2 }, { v: 'abc' })).toBe(false);
    expect(passes('length', v, { v: 12 })).toBe(false);
    expect(passes('numeric', { ...v, min: { path: '/low' } }, { v: '5', low: 3 })).toBe(true);
    expect(passes('numeric', v, { v: ' ' })).toBe(false);
    expect(passes('numeric', { ...v, max: 4 }, { v: 5 })).toBe(false);
    expect(passes('or', { values: [false, { call: 'required', args: v }] }, { v: 'x' })).toBe(true);
    expect(passes('or', { values: 'nope' })).toBe(false);
    expect(passes('not', { value: { call: 'required', args: v } }, { v: '' })).toBe(true);
    // Only validators and logic are available; a formatting or inherited name does not pass.
    expect(passes('formatString', { value: 'true' })).toBe(false);
    expect(passes('constructor', {})).toBe(false);
    expect(passes('toString', {})).toBe(false);
    // Paths follow JSON Pointer, including escapes and array indexes.
    expect(passes('required', { value: { path: '/a~1b/0/c~0d' } }, { 'a/b': [{ 'c~d': 'x' }] })).toBe(true);
    expect(passes('required', { value: { path: '/list/length' } }, { list: ['x'] })).toBe(false);
  });

  it('does not pass a condition nested beyond the supported depth', () => {
    let condition: unknown = true;
    for (let depth = 0; depth < 40; depth += 1) condition = { call: 'and', args: { values: [condition] } };
    expect(
      evaluateA2uiChecks(surface([{ id: 'root', component: 'Slider', value: 1, checks: [{ condition, message: 'deep' }] }]))
    ).toEqual([{ componentId: 'root', message: 'deep' }]);
  });

  it('treats a TextField validationRegexp on a bound value as one more rule', () => {
    const field = (extra: Record<string, unknown>, code: unknown) =>
      evaluateA2uiChecks(surface([{ id: 'root', component: 'TextField', ...extra }], { code }));
    expect(field({ value: { path: '/code' }, validationRegexp: '^[A-Z]{3}$' }, 'LYS')).toEqual([]);
    expect(field({ value: { path: '/code' }, validationRegexp: '^[A-Z]{3}$' }, 'lys')).toEqual([
      { componentId: 'root', message: 'Invalid format', path: '/code' },
    ]);
    // Authored checks come first; a literal value or an empty pattern adds no rule.
    expect(
      field({ value: { path: '/code' }, validationRegexp: '^[A-Z]{3}$', checks: [required('/code', 'Needed')] }, '')
    ).toEqual([{ componentId: 'root', message: 'Needed', path: '/code' }]);
    expect(field({ value: 'lys', validationRegexp: '^[A-Z]{3}$' }, 'lys')).toEqual([]);
    expect(field({ value: { path: '/code' }, validationRegexp: '' }, 'lys')).toEqual([]);
  });

  it('skips malformed rules and survives a non-object data model', () => {
    expect(
      evaluateA2uiChecks(
        surface(
          [
            {
              id: 'root',
              component: 'Slider',
              value: 3,
              checks: [null, 'x', { condition: false }, { condition: false, message: 7 }, { condition: false, message: 'real' }],
            },
          ],
          'not an object'
        )
      )
    ).toEqual([{ componentId: 'root', message: 'real' }]);
    expect(evaluateA2uiChecks(surface([{ id: 'root', component: 'Slider', value: 3, checks: 'nope' }]))).toEqual([]);
  });

  describe('child templates', () => {
    const rows = (data: unknown, extra: readonly Record<string, unknown>[] = []) =>
      surface(
        [
          { id: 'root', component: 'Column', children: ['list', 'top'] },
          { id: 'top', component: 'TextField', value: { path: '/title' }, checks: [required('/title', 'Title')] },
          { id: 'list', component: 'List', children: { path: '/rows', componentId: 'row' } },
          { id: 'row', component: 'Row', children: ['name'] },
          { id: 'name', component: 'TextField', value: { path: 'name' }, validationRegexp: '^[A-Z]', checks: [required('name', 'Name')] },
          ...extra,
        ],
        data
      );

    it('evaluates a templated component once per item, after the others, with the item path', () => {
      expect(evaluateA2uiChecks(rows({ title: '', rows: [{ name: 'Ada' }, { name: '' }, { name: 'grace' }] }))).toEqual([
        { componentId: 'top', message: 'Title', path: '/title' },
        { componentId: 'name', message: 'Name', path: '/rows/1/name', basePath: '/rows/1' },
        { componentId: 'name', message: 'Invalid format', path: '/rows/2/name', basePath: '/rows/2' },
      ]);
    });

    it('does not evaluate template content outside an item, even for an empty or missing list', () => {
      expect(evaluateA2uiChecks(rows({ title: 'x', rows: [] }))).toEqual([]);
      expect(evaluateA2uiChecks(rows({ title: 'x' }))).toEqual([]);
      expect(evaluateA2uiChecks(rows({ title: 'x', rows: 'no list' }))).toEqual([]);
    });

    it('follows nested templates and ends a template that names itself with its data', () => {
      const failures = evaluateA2uiChecks(
        surface(
          [
            { id: 'root', component: 'List', children: { path: '/tree', componentId: 'node' } },
            { id: 'node', component: 'Column', children: { path: 'kids', componentId: 'node' }, checks: [required('label', 'Label')] },
            { id: 'loop', component: 'List', children: { path: '/tree', componentId: 'loop' } },
          ],
          { tree: [{ label: 'a', kids: [{ label: '' }, { label: 'c', kids: [{ label: '' }] }] }] }
        )
      );
      expect(failures.map((failure) => failure.basePath)).toEqual(['/tree/0/kids/0', '/tree/0/kids/1/kids/0']);
    });
  });
});
