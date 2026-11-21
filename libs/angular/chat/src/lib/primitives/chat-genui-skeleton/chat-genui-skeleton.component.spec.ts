import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatGenuiSkeletonComponent } from './chat-genui-skeleton.component';

describe('ChatGenuiSkeletonComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [ChatGenuiSkeletonComponent] }));

  it('renders a region role with the Building UI status text', () => {
    const fx = TestBed.createComponent(ChatGenuiSkeletonComponent);
    fx.detectChanges();
    const status = fx.nativeElement.querySelector('[role="status"]');
    expect(status).toBeTruthy();
    expect(status.textContent).toContain('Building UI');
  });

  it('renders three shimmer rows', () => {
    const fx = TestBed.createComponent(ChatGenuiSkeletonComponent);
    fx.detectChanges();
    const rows = fx.nativeElement.querySelectorAll('.chat-genui-skeleton__row');
    expect(rows.length).toBe(3);
  });
});
