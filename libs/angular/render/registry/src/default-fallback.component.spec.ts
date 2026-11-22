import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { DefaultFallbackComponent } from './default-fallback.component';

describe('DefaultFallbackComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [DefaultFallbackComponent] }));

  it('renders a region role with the Building UI status text', () => {
    const fx = TestBed.createComponent(DefaultFallbackComponent);
    fx.detectChanges();
    const status = fx.nativeElement.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Building UI');
  });

  it('renders three shimmer rows', () => {
    const fx = TestBed.createComponent(DefaultFallbackComponent);
    fx.detectChanges();
    const rows = fx.nativeElement.querySelectorAll('.render-default-fallback__row');
    expect(rows.length).toBe(3);
  });
});
