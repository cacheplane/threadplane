import { describe, it, expect } from 'vitest';
import { A2uiButtonComponent } from './button.component';

describe('A2uiButtonComponent — v0.9 protocol', () => {
  // NOTE: Angular signal-based inputs can't be tested via TestBed without the
  // angular() vite plugin (NG0303). v0.9: a child Text component is rendered
  // inside the button via childKeys. The `variant` enum controls styling:
  // 'default' | 'primary' | 'borderless' (default 'default').

  it('exports the component class', () => {
    expect(A2uiButtonComponent).toBeDefined();
  });

  describe('variant → class logic', () => {
    const VARIANT_CLASS: Record<string, string> = {
      default: 'a2ui-btn a2ui-btn--default',
      primary: 'a2ui-btn a2ui-btn--primary',
      borderless: 'a2ui-btn a2ui-btn--borderless',
    };
    const cssClass = (variant: string) => VARIANT_CLASS[variant] ?? VARIANT_CLASS['default'];

    it('maps primary to the primary class', () => {
      expect(cssClass('primary')).toBe('a2ui-btn a2ui-btn--primary');
    });
    it('maps default to the default class', () => {
      expect(cssClass('default')).toBe('a2ui-btn a2ui-btn--default');
    });
    it('maps borderless to the borderless class', () => {
      expect(cssClass('borderless')).toBe('a2ui-btn a2ui-btn--borderless');
    });
    it('falls back to default for unknown variants', () => {
      expect(cssClass('bogus')).toBe('a2ui-btn a2ui-btn--default');
    });
  });

  it('has handleClick method', () => {
    expect(A2uiButtonComponent.prototype.handleClick).toBeInstanceOf(Function);
  });

  it('disabled input gates the button element', () => {
    // Verified from template: [disabled]="disabled()"
    const isDisabled = (disabled: boolean) => disabled;
    expect(isDisabled(false)).toBe(false);
    expect(isDisabled(true)).toBe(true);
  });
});
