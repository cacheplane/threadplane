import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { A2uiDefaultFallbackComponent } from './a2ui-default-fallback.component';

describe('A2uiDefaultFallbackComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [A2uiDefaultFallbackComponent] }));

  it('renders a region role with the Building UI status text', () => {
    const fx = TestBed.createComponent(A2uiDefaultFallbackComponent);
    fx.detectChanges();
    const status = fx.nativeElement.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Building UI');
  });

  it('renders three shimmer rows', () => {
    const fx = TestBed.createComponent(A2uiDefaultFallbackComponent);
    fx.detectChanges();
    const rows = fx.nativeElement.querySelectorAll('.a2ui-default-fallback__row');
    expect(rows.length).toBe(3);
  });
});
