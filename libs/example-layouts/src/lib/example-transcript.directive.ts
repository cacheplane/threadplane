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
  host: { '(scroll)': 'onScroll()' },
})
export class ExampleTranscriptDirective {
  private readonly element =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly destroyRef = inject(DestroyRef);
  private pinned = true;

  constructor() {
    afterNextRender(() => {
      const el = this.element;
      if (typeof ResizeObserver === 'undefined') return;
      let active = true;
      const observer = new ResizeObserver(() => {
        if (active && this.pinned) el.scrollTop = el.scrollHeight;
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
    this.pinned = el.scrollHeight - el.clientHeight - el.scrollTop <= 32;
  }
}
