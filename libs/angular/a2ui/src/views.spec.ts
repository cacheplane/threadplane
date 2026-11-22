import { describe, it, expect } from 'vitest';
import { Component } from '@angular/core';
import { normalizeViewEntry, type A2uiViewEntry } from './views';

@Component({ standalone: true, selector: 'chat-test-real', template: '' })
class RealCmp {}
@Component({ standalone: true, selector: 'chat-test-fb', template: '' })
class FallbackCmp {}

describe('normalizeViewEntry', () => {
  it('returns { component } for a bare Type entry', () => {
    const e = normalizeViewEntry(RealCmp);
    expect(e).toEqual({ component: RealCmp });
  });

  it('returns the entry unchanged when already in { component, fallback? } shape', () => {
    const entry: A2uiViewEntry = { component: RealCmp, fallback: FallbackCmp };
    expect(normalizeViewEntry(entry)).toBe(entry);
  });

  it('preserves fallback omission', () => {
    const e = normalizeViewEntry({ component: RealCmp });
    expect(e.component).toBe(RealCmp);
    expect(e.fallback).toBeUndefined();
  });
});
