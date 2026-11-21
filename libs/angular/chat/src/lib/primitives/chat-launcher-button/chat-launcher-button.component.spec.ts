import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { ChatLauncherButtonComponent } from './chat-launcher-button.component';

describe('ChatLauncherButtonComponent', () => {
  it('renders a button', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(ChatLauncherButtonComponent);
    fx.detectChanges();
    const btn = (fx.nativeElement as HTMLElement).querySelector('.chat-launcher-button');
    expect(btn).toBeTruthy();
    expect(btn!.tagName).toBe('BUTTON');
    expect(btn!.getAttribute('aria-label')).toBe('Open chat');
  });

  it('contains an svg icon', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(ChatLauncherButtonComponent);
    fx.detectChanges();
    const svg = (fx.nativeElement as HTMLElement).querySelector('.chat-launcher-button svg');
    expect(svg).toBeTruthy();
  });

  it('emits clicked output when the inner button is clicked', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(ChatLauncherButtonComponent);
    fx.detectChanges();
    let fired = 0;
    fx.componentInstance.clicked.subscribe(() => fired++);
    const btn = (fx.nativeElement as HTMLElement).querySelector('button.chat-launcher-button') as HTMLButtonElement;
    btn.click();
    expect(fired).toBe(1);
  });

  it('keeps native (click) on the host working — event bubbles through', () => {
    // Back-compat: existing consumers that bind `(click)` on
    // <chat-launcher-button> must continue to fire on inner-button clicks.
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(ChatLauncherButtonComponent);
    fx.detectChanges();
    let hostClicks = 0;
    fx.nativeElement.addEventListener('click', () => hostClicks++);
    const btn = (fx.nativeElement as HTMLElement).querySelector('button.chat-launcher-button') as HTMLButtonElement;
    btn.click();
    expect(hostClicks).toBe(1);
  });
});
