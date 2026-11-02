// libs/chat/src/lib/primitives/chat-scroll-bubble/chat-scroll-bubble.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatScrollBubbleComponent } from './chat-scroll-bubble.component';

describe('ChatScrollBubbleComponent', () => {
  function render(mode: 'streaming' | 'idle') {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(ChatScrollBubbleComponent);
    fixture.componentRef.setInput('mode', mode);
    fixture.detectChanges();
    return fixture;
  }

  it('renders three animated dots in streaming mode', () => {
    const fixture = render('streaming');
    const dots = fixture.nativeElement.querySelectorAll('.chat-scroll-bubble__dot');
    expect(dots.length).toBe(3);
    expect(fixture.nativeElement.querySelector('.chat-scroll-bubble__arrow')).toBeNull();
  });

  it('renders a down-arrow in idle mode', () => {
    const fixture = render('idle');
    expect(fixture.nativeElement.querySelector('.chat-scroll-bubble__arrow')).not.toBeNull();
    expect(fixture.nativeElement.querySelectorAll('.chat-scroll-bubble__dot').length).toBe(0);
  });

  it('emits clicked when the button is clicked', () => {
    const fixture = render('idle');
    let clicks = 0;
    fixture.componentInstance.clicked.subscribe(() => clicks++);
    fixture.nativeElement.querySelector('button')!.click();
    expect(clicks).toBe(1);
  });

  it('names the scroll action in streaming mode too', () => {
    expect(render('streaming').nativeElement.querySelector('button')!.getAttribute('aria-label'))
      .toBe('Scroll to latest, response in progress');
  });

  it('uses aria-label "Scroll to latest" in idle mode', () => {
    expect(render('idle').nativeElement.querySelector('button')!.getAttribute('aria-label'))
      .toBe('Scroll to latest');
  });
});
