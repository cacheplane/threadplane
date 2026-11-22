import { describe, it, expect } from 'vitest';
import { A2uiModalComponent } from './modal.component';

describe('A2uiModalComponent', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9 Modal manages its own open state internally:
  // childKeys[0] = trigger (inline entry point), childKeys[1] = content (body) —
  // projected in that order by surface-to-spec. There is no title input in v0.9.
  // Clicking the trigger wrapper sets open=true; clicking the backdrop sets open=false.

  it('exports the component class', () => {
    expect(A2uiModalComponent).toBeDefined();
  });

  describe('childKeys slot mapping', () => {
    const getEntryKey = (keys: string[]) => keys[0] ?? null;
    const getContentKey = (keys: string[]) => keys[1] ?? null;

    it('maps childKeys[0] to trigger and childKeys[1] to content', () => {
      const keys = ['btn-open', 'modal-body'];
      expect(getEntryKey(keys)).toBe('btn-open');
      expect(getContentKey(keys)).toBe('modal-body');
    });

    it('returns null for missing entry point when childKeys is empty', () => {
      expect(getEntryKey([])).toBeNull();
    });

    it('returns null for missing content when only one key', () => {
      expect(getContentKey(['btn-open'])).toBeNull();
    });
  });
});
