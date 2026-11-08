import { createElement, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_WORKBENCH_LAYOUT,
  normalizeWorkbenchLayout,
  readWorkbenchLayout,
  WORKBENCH_LAYOUT_STORAGE_KEY,
  writeWorkbenchLayout,
} from './workbench-layout';
import { useWorkbenchLayout } from './use-workbench-layout';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('workbench layout preferences', () => {
  it('uses bounded finite values and defaults missing or invalid fields', () => {
    expect(DEFAULT_WORKBENCH_LAYOUT).toEqual({
      split: 44,
      height: 400,
      files: 190,
    });
    expect(
      normalizeWorkbenchLayout({ split: 100, height: 20, files: 1000 })
    ).toEqual({
      split: 75,
      height: 360,
      files: 320,
    });
    expect(
      normalizeWorkbenchLayout({ split: -1, height: 900, files: 1 })
    ).toEqual({
      split: 25,
      height: 800,
      files: 140,
    });
    for (const value of [
      null,
      [],
      'bad',
      42,
      { split: NaN, height: Infinity, files: '200' },
    ]) {
      expect(normalizeWorkbenchLayout(value)).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    }
    expect(normalizeWorkbenchLayout({ split: 55 })).toEqual({
      ...DEFAULT_WORKBENCH_LAYOUT,
      split: 55,
    });
  });

  it('recovers from malformed stored JSON and clamps valid stored preferences', () => {
    localStorage.setItem(WORKBENCH_LAYOUT_STORAGE_KEY, '{broken');
    expect(readWorkbenchLayout()).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    localStorage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify({ split: 99, height: 650 })
    );
    expect(readWorkbenchLayout()).toEqual({
      split: 75,
      height: 650,
      files: 190,
    });
  });

  it('tolerates blocked storage reads and writes', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readWorkbenchLayout()).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(() => writeWorkbenchLayout(DEFAULT_WORKBENCH_LAYOUT)).not.toThrow();
  });

  it('keeps controls usable when accessing localStorage itself throws', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('denied');
    });
    const { result } = renderHook(useWorkbenchLayout);
    expect(result.current.layout).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    act(() => result.current.update({ split: 60 }));
    expect(result.current.layout.split).toBe(60);
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it('renders defaults on the server and restores saved values after mounting without writing', () => {
    localStorage.setItem(
      WORKBENCH_LAYOUT_STORAGE_KEY,
      JSON.stringify({ split: 60, height: 640, files: 240 })
    );
    function Snapshot() {
      return createElement(
        'output',
        null,
        JSON.stringify(useWorkbenchLayout().layout)
      );
    }
    expect(renderToString(createElement(Snapshot))).toContain(
      '&quot;split&quot;:44'
    );
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(useWorkbenchLayout, { wrapper: StrictMode });
    expect(result.current.layout).toEqual({
      split: 60,
      height: 640,
      files: 240,
    });
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps transient drag updates in memory and persists the complete latest layout once requested', () => {
    const write = vi.spyOn(Storage.prototype, 'setItem');
    const { result } = renderHook(useWorkbenchLayout);
    act(() => {
      result.current.update({ split: 60 }, false);
      result.current.update({ files: 240 }, false);
    });
    expect(result.current.layout).toEqual({
      split: 60,
      height: 400,
      files: 240,
    });
    expect(write).not.toHaveBeenCalled();
    act(() => result.current.update({ height: 1000 }));
    expect(
      JSON.parse(localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) ?? 'null')
    ).toEqual({ split: 60, height: 800, files: 240 });
    expect(write).toHaveBeenCalledOnce();
    act(() => result.current.reset());
    expect(result.current.layout).toEqual(DEFAULT_WORKBENCH_LAYOUT);
    expect(
      JSON.parse(localStorage.getItem(WORKBENCH_LAYOUT_STORAGE_KEY) ?? 'null')
    ).toEqual(DEFAULT_WORKBENCH_LAYOUT);
  });

  it('does not write preferences through stale callbacks after unmount', () => {
    const { result, unmount } = renderHook(useWorkbenchLayout);
    const { update, reset } = result.current;
    const write = vi.spyOn(Storage.prototype, 'setItem');
    unmount();
    act(() => {
      update({ split: 70 });
      reset();
    });
    expect(write).not.toHaveBeenCalled();
  });
});
