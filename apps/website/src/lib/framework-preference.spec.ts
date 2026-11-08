import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameworkPreferenceStore, FRAMEWORK_PREFERENCE_KEY, frameworkForPath, preferredDocsHref } from './framework-preference';

beforeEach(() => window.localStorage.clear());

describe('framework preference', () => {
  it.each(['angular', 'react'] as const)('starts %s at its quickstart', (framework) => {
    expect(preferredDocsHref(framework)).toBe(`/docs/${framework}/getting-started/quickstart`);
  });
  it('has a stable Angular server default and rejects invalid stored values', () => {
    localStorage.setItem(FRAMEWORK_PREFERENCE_KEY, 'vue');
    const store = createFrameworkPreferenceStore();
    expect(store.getServerSnapshot()).toBe('angular');
    expect(store.getSnapshot()).toBe('angular');
    localStorage.setItem(FRAMEWORK_PREFERENCE_KEY, 'react');
    expect(createFrameworkPreferenceStore().getSnapshot()).toBe('react');
  });

  it('keeps framework routes authoritative over opposite preferences and obsolete queries', () => {
    expect(frameworkForPath('/docs/react/langgraph/guides/streaming?frontend=angular', 'angular')).toBe('react');
    expect(frameworkForPath('/docs/angular/langgraph/guides/streaming', 'react')).toBe('angular');
    expect(frameworkForPath('/docs/shared/middleware/guides/python-langgraph', 'react')).toBe('react');
    expect(frameworkForPath('/docs/api/react/useAgent', 'angular')).toBe('angular');
  });

  it('notifies same-tab subscribers and persists explicit choices', () => {
    const store = createFrameworkPreferenceStore();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.setPreference('react');
    expect(store.getSnapshot()).toBe('react');
    expect(localStorage.getItem(FRAMEWORK_PREFERENCE_KEY)).toBe('react');
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.setPreference('angular');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('retains in-memory selection when storage reads and writes throw', () => {
    const store = createFrameworkPreferenceStore(() => { throw new Error('blocked'); });
    expect(store.getSnapshot()).toBe('angular');
    store.setPreference('react');
    expect(store.getSnapshot()).toBe('react');
    const unsubscribe = store.subscribe(() => undefined);
    expect(store.getSnapshot()).toBe('react');
    unsubscribe();
  });

  it('handles cross-tab changes without changing route authority and removes its listener', () => {
    const store = createFrameworkPreferenceStore();
    const listener = vi.fn();
    const remove = vi.spyOn(window, 'removeEventListener');
    const unsubscribe = store.subscribe(listener);
    window.dispatchEvent(new StorageEvent('storage', { key: FRAMEWORK_PREFERENCE_KEY, newValue: 'react' }));
    expect(store.getSnapshot()).toBe('react');
    expect(frameworkForPath('/docs/angular/langgraph/guides/streaming', store.getSnapshot())).toBe('angular');
    window.dispatchEvent(new StorageEvent('storage', { key: FRAMEWORK_PREFERENCE_KEY, newValue: 'invalid' }));
    expect(store.getSnapshot()).toBe('angular');
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    expect(remove).toHaveBeenCalledWith('storage', expect.any(Function));
    remove.mockRestore();
  });
});
