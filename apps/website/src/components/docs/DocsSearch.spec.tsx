// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { DocsSearch } from './DocsSearch';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('../../lib/analytics/client', () => ({ track: vi.fn() }));

const HIT = {
  href: '/docs/angular/langgraph/guides/persistence#production-checkpointers',
  title: 'Persistence',
  heading: 'Production checkpointers',
  libraryTitle: 'LangGraph',
  snippet: 'Use a Postgres checkpointer in production.',
  marks: [[6, 14]] as [number, number][],
};

function openSearch() {
  render(<DocsSearch />);
  fireEvent.keyDown(document, { key: 'k', metaKey: true });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  // jsdom does not implement scrollIntoView; the "scroll the selected
  // option into view" effect calls it unconditionally.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DocsSearch content results', () => {
  it('renders server hits with their heading and a highlighted snippet', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [HIT] }) })
    );
    openSearch();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'checkpointer' } });

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());
    // The mark is rendered from offsets, never from server HTML.
    expect(screen.getByText('Postgres').tagName).toBe('MARK');
  });

  it('still shows instant title results when the request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
    openSearch();
    // "quickstart" matches page titles in the client-side index.
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'quickstart' } });

    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0));
    // A failed search must never surface an error state in the dialog.
    expect(screen.queryByText(/error/i)).toBeNull();
  });

  it('does not request for a query under two characters', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    openSearch();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'a' } });

    await vi.advanceTimersByTimeAsync(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reaches the first content hit by arrowing past the last title hit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [HIT] }) })
    );
    openSearch();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'checkpointer' } });

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());

    const options = screen.getAllByRole('option');
    // Arrow down once per option to walk off the end of the title group and
    // into the content group.
    for (let i = 0; i < options.length; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }

    const contentOption = screen.getByText('Production checkpointers').closest('[role="option"]');
    expect(contentOption?.getAttribute('aria-selected')).toBe('true');
  });

  it('navigates to the content hit href (including the anchor) on Enter', async () => {
    const push = vi.fn();
    const navModule = await import('next/navigation');
    vi.spyOn(navModule, 'useRouter').mockReturnValue({ push } as unknown as ReturnType<typeof navModule.useRouter>);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [HIT] }) })
    );
    openSearch();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'checkpointer' } });

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());

    const options = screen.getAllByRole('option');
    for (let i = 0; i < options.length; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(push).toHaveBeenCalledWith(HIT.href);
  });

  it('keeps exactly one option marked aria-selected at a time', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [HIT] }) })
    );
    openSearch();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'checkpointer' } });

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());

    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const options = screen.getAllByRole('option');
    const selectedCount = options.filter((o) => o.getAttribute('aria-selected') === 'true').length;
    expect(selectedCount).toBe(1);
  });

  it('clamps the selected index when a narrower query shrinks the results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [HIT] }) })
    );
    openSearch();
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'checkpointer' } });
    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());

    const options = screen.getAllByRole('option');
    for (let i = 0; i < options.length; i++) {
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    }

    // Now narrow the query to something that matches nothing at all — the
    // previously-selected index must not dangle past the new (empty) list.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [] }) }));
    fireEvent.change(input, { target: { value: 'zzzzzznomatch' } });

    await waitFor(() => expect(screen.queryAllByRole('option').length).toBe(0));
    // No option is present, so nothing should throw when Enter is pressed
    // and there is nothing to navigate to.
    expect(() => fireEvent.keyDown(input, { key: 'Enter' })).not.toThrow();
  });

  it('lets a newer query win when an older request resolves later', async () => {
    let resolveFirst: (v: unknown) => void = () => undefined;
    let resolveSecond: (v: unknown) => void = () => undefined;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    vi.stubGlobal('fetch', fetchMock);

    openSearch();
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'first query' } });
    await vi.advanceTimersByTimeAsync(150);

    fireEvent.change(input, { target: { value: 'second query' } });
    await vi.advanceTimersByTimeAsync(150);

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const secondHit = { ...HIT, heading: 'Second query heading' };
    const firstHit = { ...HIT, heading: 'First query heading', href: '/docs/first' };

    // Resolve the newer (second) request first, then the stale first one.
    resolveSecond({ ok: true, json: async () => ({ results: [secondHit] }) });
    await waitFor(() => expect(screen.getByText('Second query heading')).toBeTruthy());

    resolveFirst({ ok: true, json: async () => ({ results: [firstHit] }) });
    // Give the stale promise a chance to resolve and (if buggy) clobber state.
    await vi.advanceTimersByTimeAsync(0);

    expect(screen.queryByText('First query heading')).toBeNull();
    expect(screen.getByText('Second query heading')).toBeTruthy();
  });
});

describe('DocsSearch snippet rendering', () => {
  it('renders HTML-ish snippet text as plain text, never as markup', async () => {
    const xssHit = {
      ...HIT,
      snippet: 'a <script>alert(1)</script> b',
      marks: [[2, 10]] as [number, number][],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [xssHit] }) })
    );
    openSearch();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'checkpointer' } });

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());

    expect(document.querySelector('script')).toBeNull();
    const mark = document.querySelector('mark');
    expect(mark?.textContent).toBe('<script>');
  });

  it('does not throw on an out-of-range or out-of-order mark', async () => {
    const badMarksHit = {
      ...HIT,
      snippet: 'short snippet',
      marks: [
        [5, 2],
        [100, 200],
      ] as [number, number][],
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ results: [badMarksHit] }) })
    );
    openSearch();
    expect(() => {
      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'checkpointer' } });
    }).not.toThrow();

    await waitFor(() => expect(screen.getByText('Production checkpointers')).toBeTruthy());
  });
});
