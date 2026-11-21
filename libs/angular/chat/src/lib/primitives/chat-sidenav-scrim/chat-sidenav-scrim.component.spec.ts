import { describe, it, expect, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatSidenavScrimComponent } from './chat-sidenav-scrim.component';

describe('ChatSidenavScrimComponent', () => {
  let fx: ComponentFixture<ChatSidenavScrimComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ChatSidenavScrimComponent] });
    fx = TestBed.createComponent(ChatSidenavScrimComponent);
  });

  it('renders nothing when [open] is false (default)', () => {
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('button')).toBeNull();
  });

  it('renders the scrim button when [open] is true', () => {
    fx.componentRef.setInput('open', true);
    fx.detectChanges();
    const btn = fx.nativeElement.querySelector('button.chat-sidenav-scrim__button') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    expect(btn.getAttribute('aria-label')).toBe('Close conversations');
  });

  it('emits (dismiss) on click', () => {
    fx.componentRef.setInput('open', true);
    fx.detectChanges();
    let dismissed = false;
    fx.componentInstance.dismiss.subscribe(() => { dismissed = true; });
    const btn = fx.nativeElement.querySelector('button.chat-sidenav-scrim__button') as HTMLButtonElement;
    btn.click();
    expect(dismissed).toBe(true);
  });
});
