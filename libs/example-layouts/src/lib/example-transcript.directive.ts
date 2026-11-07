import {
  afterNextRender,
  DestroyRef,
  Directive,
  ElementRef,
  inject,
} from '@angular/core';

/** Keeps standalone example transcripts following new content until the reader scrolls up. */
@Directive({
  selector: '[exampleTranscript]',
  host: {
    '(scroll)': 'onScroll()',
    role: 'region',
    'aria-label': 'Conversation',
    tabindex: '0',
  },
})
export class ExampleTranscriptDirective {
  private readonly element =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private pinned = true;
  private lastScrollTop = 0;

  constructor() {
    afterNextRender(() => {
      const el = this.element;
      if (typeof ResizeObserver === 'undefined') return;
      let active = true;
      const observer = new ResizeObserver(() => {
        if (active && this.pinned) {
          el.scrollTop = el.scrollHeight;
          this.lastScrollTop = el.scrollTop;
        }
      });
      observer.observe(el);
      if (el.firstElementChild) observer.observe(el.firstElementChild);
      this.destroyRef.onDestroy(() => {
        active = false;
        observer.disconnect();
      });
    });
  }

  protected onScroll(): void {
    const el = this.element;
    const max = Math.max(0, el.scrollHeight - el.clientHeight);
    // A delayed event from our own follow can arrive after the next chunk.
    // Only movement toward older content unpins; viewport growth may clamp
    // the previous position to a smaller scroll range without reader input.
    if (el.scrollTop < Math.min(this.lastScrollTop, max) - 1) this.pinned = false;
    else if (max - el.scrollTop <= 32) this.pinned = true;
    this.lastScrollTop = el.scrollTop;
  }
}
