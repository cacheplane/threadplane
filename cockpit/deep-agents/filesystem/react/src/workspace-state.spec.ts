import { describe, expect, it } from 'vitest';
import { workspaceState, selectWorkspacePath } from './workspace-state';
function validWorkspace(input: unknown) {
  const state = workspaceState(input);
  expect(state.kind).toBe('valid');
  if (state.kind !== 'valid') throw new Error('Expected valid workspace');
  return state;
}

describe('saved workspace projection', () => {
  it('distinguishes initial missing, valid empty and malformed whole maps', () => {
    expect(workspaceState(undefined)).toEqual({ kind: 'missing', files: [] });
    expect(workspaceState({})).toEqual({ kind: 'missing', files: [] });
    expect(workspaceState({ files: {} })).toEqual({
      kind: 'valid',
      files: [],
      complete: true,
    });
    for (const files of [null, [], 'text', 1])
      expect(workspaceState({ files }).kind).toBe('invalid');
  });
  it('projects UTF8 strings, legacy lines and empty content, ordered with selection', () => {
    const state = validWorkspace({
      files: {
        '/z': {
          content: '',
          encoding: 'utf-8',
          created_at: 'now',
          modified_at: 'later',
        },
        '/a': { content: ['one', 'two'] },
        '/b': { content: 'plain' },
      },
    });
    expect(state).toEqual({
      kind: 'valid',
      complete: true,
      files: [
        { path: '/a', kind: 'text', content: 'one\ntwo' },
        { path: '/b', kind: 'text', content: 'plain' },
        {
          path: '/z',
          kind: 'text',
          content: '',
          created_at: 'now',
          modified_at: 'later',
        },
      ],
    });
    expect(selectWorkspacePath(state, '/b')).toBe('/b');
    expect(selectWorkspacePath(state, '/missing')).toBe('/a');
    expect(Object.isFrozen(state.files[0])).toBe(true);
  });
  it('keeps unsupported individual records visibly unavailable', () => {
    for (const record of [
      { content: 'YWJj', encoding: 'base64' },
      { content: 1 },
      'abc',
      { content: 'x', hidden: true },
    ]) {
      const state = validWorkspace({ files: { '/a': record } });
      expect(state.kind).toBe('valid');
      expect(state.complete).toBe(false);
      expect(state.files[0]).toMatchObject({ path: '/a', kind: 'unavailable' });
      expect(state.files[0]).not.toHaveProperty('content');
    }
  });
  it.each([
    'relative',
    '/a//b',
    '/a/../b',
    '/a/./b',
    '/a\\b',
    '/a\u0000b',
    '/',
    '/a/',
    '/' + 'x'.repeat(1024),
  ])('rejects unsupported map path %s', (path) => {
    expect(workspaceState({ files: { [path]: { content: 'x' } } }).kind).toBe(
      'invalid'
    );
  });
  it('enforces file count and content bounds before copying or joining', () => {
    expect(
      workspaceState({
        files: Object.fromEntries(
          Array.from({ length: 101 }, (_, i) => ['/f' + i, { content: '' }])
        ),
      }).kind
    ).toBe('invalid');
    expect(
      validWorkspace({ files: { '/a': { content: 'x'.repeat(65536) } } })
        .complete
    ).toBe(true);
    for (const content of [
      'x'.repeat(65537),
      ['x'.repeat(65536), ''],
      Array(65538).fill(''),
    ]) {
      expect(
        validWorkspace({ files: { '/a': { content } } }).files[0].kind
      ).toBe('unavailable');
    }
    const files = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [
        '/f' + i,
        { content: 'x'.repeat(65536) },
      ])
    );
    const state = validWorkspace({ files });
    expect(state.complete).toBe(false);
    expect(state.files.filter((f: any) => f.kind === 'text')).toHaveLength(16);
  });
  it('rejects non-JSON containers without evaluating getters', () => {
    let hits = 0;
    const getter = {
      get files() {
        hits++;
        return {};
      },
    };
    const cycle: any = {};
    cycle.self = cycle;
    const sparse = Array(2);
    sparse[1] = 'x';
    const extended: any = ['x'];
    extended.extra = true;
    for (const value of [
      getter,
      { files: { [Symbol('hidden')]: 'x' } },
      { files: Object.create({}) },
      { files: cycle },
      { files: { '/a': { content: sparse } } },
      { files: { '/a': { content: extended } } },
    ]) {
      expect(workspaceState(value).kind).toBe('invalid');
    }
    expect(hits).toBe(0);
  });
  it('does not evaluate accessors introduced during descriptor inspection', () => {
    let reads = 0;
    const values: Record<string, unknown> = {
      files: { '/old': { content: 'saved' } },
    };
    values.later = new Proxy(
      {},
      {
        getPrototypeOf() {
          Object.defineProperty(values, 'files', {
            enumerable: true,
            configurable: true,
            get() {
              reads++;
              return {};
            },
          });
          return Object.prototype;
        },
      }
    );
    expect(workspaceState(values).kind).toBe('invalid');
    expect(reads).toBe(0);
  });
  it('accepts two content-bounded legacy arrays without consuming canonical evidence nodes', () => {
    const state = validWorkspace({
      files: {
        '/a': { content: Array(65536).fill('') },
        '/b': { content: Array(65536).fill('') },
      },
    });
    expect(state.complete).toBe(true);
    expect(state.files).toHaveLength(2);
  });
  it('accepts the exact legacy aggregate boundary and marks the next file unavailable', () => {
    const files = Object.fromEntries(
      Array.from({ length: 16 }, (_, i) => [
        '/f' + String(i).padStart(2, '0'),
        { content: Array(65537).fill('') },
      ])
    );
    const boundary = validWorkspace({ files });
    expect(boundary.complete).toBe(true);
    expect(
      boundary.files.reduce(
        (n, file) => n + (file.kind === 'text' ? file.content.length : 0),
        0
      )
    ).toBe(1048576);
    const overflow = validWorkspace({
      files: { ...files, '/z': { content: ['x'] } },
    });
    expect(overflow.complete).toBe(false);
    expect(overflow.files.at(-1)?.kind).toBe('unavailable');
  });
  it('retains the canonical non-file JSON node limit', () => {
    expect(
      workspaceState({ files: {}, arbitrary: Array(100001).fill('') }).kind
    ).toBe('invalid');
  });
});
