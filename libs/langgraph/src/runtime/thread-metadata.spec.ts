import { describe, expect, it } from 'vitest';
import { orderThreads, projectThread } from './thread-metadata';

describe('projectThread', () => {
  it('projects well-formed metadata', () => {
    expect(
      projectThread(
        {
          thread_id: 't1',
          updated_at: '2026-01-01T00:00:00.000Z',
          metadata: {
            title: '  Trip  ',
            archived: true,
            pinned: true,
            pinnedOrder: 3,
            projectId: 'p1',
          },
        },
        'New chat'
      )
    ).toEqual({
      id: 't1',
      title: 'Trip',
      updatedAt: Date.parse('2026-01-01T00:00:00.000Z'),
      pinned: true,
      archived: true,
      projectId: 'p1',
      pinnedOrder: 3,
    });
  });

  it('applies fallbacks to malformed metadata', () => {
    const entry = projectThread(
      {
        thread_id: 't1',
        updated_at: 'not a date',
        metadata: {
          title: '  ',
          archived: 'yes',
          pinned: 1,
          pinnedOrder: '2',
          projectId: '   ',
        },
      },
      'New chat'
    );
    expect(entry).toEqual({
      id: 't1',
      title: 'New chat',
      pinned: false,
      archived: false,
      projectId: null,
    });
    expect('updatedAt' in entry).toBe(false);
    expect('pinnedOrder' in entry).toBe(false);
  });

  it('ignores non-finite pin order and non-object metadata', () => {
    expect(
      projectThread(
        { thread_id: 't1', metadata: { pinnedOrder: Infinity } },
        'Untitled'
      )
    ).not.toHaveProperty('pinnedOrder');
    for (const metadata of [null, undefined, 'title', ['x']]) {
      expect(projectThread({ thread_id: 't1', metadata }, 'Untitled')).toEqual({
        id: 't1',
        title: 'Untitled',
        pinned: false,
        archived: false,
        projectId: null,
      });
    }
  });

  it('returns a frozen entry', () => {
    expect(Object.isFrozen(projectThread({ thread_id: 't1' }, 'x'))).toBe(true);
  });
});

describe('orderThreads', () => {
  const entry = (
    id: string,
    patch: { pinned?: boolean; archived?: boolean; pinnedOrder?: number } = {}
  ) => ({
    id,
    title: id,
    pinned: patch.pinned ?? false,
    archived: patch.archived ?? false,
    projectId: null,
    ...(patch.pinnedOrder === undefined ? {} : { pinnedOrder: patch.pinnedOrder }),
  });

  it('puts pinned threads first by pin order and keeps server order otherwise', () => {
    const { threads, archived } = orderThreads([
      entry('new'),
      entry('pin-none', { pinned: true }),
      entry('gone-1', { archived: true }),
      entry('pin-1', { pinned: true, pinnedOrder: 1 }),
      entry('old'),
      entry('gone-2', { archived: true, pinned: true }),
      entry('pin-0', { pinned: true, pinnedOrder: 0 }),
    ]);
    expect(threads.map((t) => t.id)).toEqual([
      'pin-0',
      'pin-1',
      'pin-none',
      'new',
      'old',
    ]);
    expect(archived.map((t) => t.id)).toEqual(['gone-1', 'gone-2']);
  });

  it('keeps entries by reference', () => {
    const a = entry('a');
    expect(orderThreads([a]).threads[0]).toBe(a);
  });
});
