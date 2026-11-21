import { describe, it, expect } from 'vitest';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatWelcomeComponent } from './chat-welcome.component';

@Component({
  standalone: true,
  imports: [ChatWelcomeComponent],
  template: `
    <chat-welcome>
      <input chatWelcomeInput />
    </chat-welcome>
  `,
})
class Host {}

describe('ChatWelcomeComponent', () => {
  it('renders default greeting', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(Host);
    fx.detectChanges();
    const win = fx.nativeElement.querySelector('chat-welcome') as HTMLElement;
    expect(win.querySelector('.chat-welcome__title')?.textContent).toContain('How can I help?');
  });

  it('renders the beacon dot', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(Host);
    fx.detectChanges();
    const win = fx.nativeElement.querySelector('chat-welcome') as HTMLElement;
    expect(win.querySelector('.chat-welcome__beacon')).not.toBeNull();
  });

  it('exposes slots for title, subtitle, input, suggestions', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(Host);
    fx.detectChanges();
    const win = fx.nativeElement.querySelector('chat-welcome') as HTMLElement;
    expect(win.querySelector('.chat-welcome__inner')).not.toBeNull();
    expect(win.querySelector('.chat-welcome__input')).not.toBeNull();
    expect(win.querySelector('.chat-welcome__suggestions')).not.toBeNull();
  });

  it('does not render a subtitle slot', () => {
    TestBed.configureTestingModule({});
    const fx = TestBed.createComponent(Host);
    fx.detectChanges();
    const win = fx.nativeElement.querySelector('chat-welcome') as HTMLElement;
    expect(win.querySelector('.chat-welcome__subtitle')).toBeNull();
  });
});
