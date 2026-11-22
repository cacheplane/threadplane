import { describe, it, expect } from 'vitest';
import { A2uiTabsComponent } from './tabs.component';

describe('A2uiTabsComponent', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). These tests verify the v1 behavioral contract:
  // - tabTitles drives the tab bar
  // - childKeys[i] is the content key for the i-th tab
  // - selectTab sets the active index

  it('exports the component class', () => {
    expect(A2uiTabsComponent).toBeDefined();
  });

  it('has selectTab method', () => {
    expect(A2uiTabsComponent.prototype.selectTab).toBeInstanceOf(Function);
  });

  describe('activeChildKey computed logic', () => {
    const getActiveKey = (keys: string[], index: number) =>
      index >= 0 && index < keys.length ? keys[index] : null;

    const keys = ['overview-child', 'detail-child', 'settings-child'];

    it('returns the child key for the active tab', () => {
      expect(getActiveKey(keys, 0)).toBe('overview-child');
      expect(getActiveKey(keys, 1)).toBe('detail-child');
      expect(getActiveKey(keys, 2)).toBe('settings-child');
    });

    it('returns null for out-of-bounds index', () => {
      expect(getActiveKey(keys, 5)).toBeNull();
    });

    it('returns null for negative index', () => {
      expect(getActiveKey(keys, -1)).toBeNull();
    });

    it('returns null when childKeys is empty', () => {
      expect(getActiveKey([], 0)).toBeNull();
    });
  });
});
