import { describe, expect, it } from 'vitest';
import { captureMemoryMap, projectMemory } from './memory-projection';
import { captureAuthority } from './authority';
const scope = '11111111-1111-4111-8111-111111111111',
  path = '/memories/AGENTS.md';
const base = {
  owner: scope,
  currentOwner: scope,
  generation: 'g',
  currentGeneration: 'g',
  scope,
};
const custom = (contents: unknown = {}, phase: unknown = 'model') => ({
  ...base,
  source: 'custom',
  event: {
    name: 'deep_agents.memory',
    data: { memory_contents: contents, memory_scope_owner: scope, phase },
  },
});
describe('literal bounded memory observations', () => {
  it('distinguishes no source, unavailable, missing and present empty', () => {
    expect(projectMemory({ ...base, source: 'none' })?.kind).toBe('none');
    expect(projectMemory({ ...base, source: 'unavailable' })?.kind).toBe(
      'unavailable'
    );
    expect(projectMemory(custom({}))).toMatchObject({ file: 'missing' });
    expect(projectMemory(custom({ [path]: '' }))).toMatchObject({
      file: 'present',
    });
    expect(projectMemory(custom({ [path]: '' }))).toMatchObject({
      contents: '',
    });
  });
  it.each(['initial', 'model', 'terminal'])(
    'accepts actual custom %s as live observation only',
    (phase) => {
      expect(
        projectMemory(custom({ [path]: ' \n\nText\t\n' }, phase))
      ).toMatchObject({
        kind: 'live',
        file: 'present',
        contents: ' \n\nText\t\n',
        phase,
        scope,
        generation: 'g',
      });
    }
  );
  it('rejects unsupported, malformed, stale or wrong-scope sources', () => {
    for (const input of [
      { ...custom(), currentOwner: 'wrong' },
      { ...custom(), currentGeneration: 'old' },
      custom({}, 'other'),
      { ...custom(), source: 'metadata' },
      { ...custom(), event: { name: 'other', data: {} } },
      {
        ...custom(),
        event: {
          name: 'deep_agents.memory',
          data: {
            memory_contents: {},
            memory_scope_owner: 'wrong',
            phase: 'model',
          },
        },
      },
      {
        ...custom(),
        event: {
          name: 'deep_agents.memory',
          data: {
            memory_contents: {},
            memory_scope_owner: scope,
            phase: 'model',
            extra: 1,
          },
        },
      },
      { ...custom(), scope: 'bad' },
    ])
      expect(projectMemory(input)?.kind).toBe('unavailable');
  });
  it('does not infer checkpoint confirmation from prose, tools or terminal custom phase', () => {
    expect(
      projectMemory({
        ...base,
        source: 'checkpoint',
        authority: captureAuthority({}),
      })?.kind
    ).toBe('unavailable');
    expect(projectMemory(custom({}, 'terminal'))?.kind).toBe('live');
  });
  it('owns maps and rejects adversarial prototypes/accessors/hidden/symbol/extra keys', () => {
    const input = { [path]: 'literal' };
    const captured = captureMemoryMap(input);
    expect(captured).toEqual(input);
    input[path] = 'changed';
    expect(captured?.[path]).toBe('literal');
    expect(Object.isFrozen(captured)).toBe(true);
    let accessed = false;
    for (const bad of [
      [],
      null,
      new Date(),
      { extra: '' },
      { [path]: 1 },
      Object.create({ [path]: 'inherited' }),
      Object.defineProperty({}, path, {
        get() {
          accessed = true;
          throw Error();
        },
        enumerable: true,
      }),
      Object.defineProperty({}, path, { value: 'hidden' }),
      { [Symbol('x')]: '' },
    ])
      expect(captureMemoryMap(bad)).toBeUndefined();
    expect(accessed).toBe(false);
  });
  it('enforces UTF8 byte boundaries and rejects unpaired surrogate replacement', () => {
    for (const value of [
      'a'.repeat(65536),
      'é'.repeat(32768),
      '😀'.repeat(16384),
    ])
      expect(captureMemoryMap({ [path]: value })?.[path]).toBe(value);
    for (const value of [
      'a'.repeat(65537),
      'é'.repeat(32769),
      '😀'.repeat(16385),
      '\ud800',
      '\udfff',
      'x\ud800x',
    ])
      expect(captureMemoryMap({ [path]: value })).toBeUndefined();
  });
  it('sanitizes throwing source access without evaluating getters', () => {
    let accessed = false;
    const input = Object.defineProperty(
      { ...base, source: 'custom' },
      'event',
      {
        enumerable: true,
        get() {
          accessed = true;
          throw Error();
        },
      }
    );
    expect(projectMemory(input)?.kind).toBe('unavailable');
    expect(accessed).toBe(false);
  });
});
