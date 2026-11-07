import { DestroyRef, ElementRef, inject } from '@angular/core';

/** iOS resizes the visual viewport for its keyboard, but leaves dvh unchanged. */
export function installExampleViewport(): void {
  const element = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  const destroyRef = inject(DestroyRef);
  const viewport = element.ownerDocument.defaultView?.visualViewport;
  if (!viewport) return;
  const resize = () => {
    // Preserve the layout while readers pinch zoom and pan around it.
    if (viewport.scale !== 1) return;
    element.style.setProperty('--example-viewport-height', `${viewport.height}px`);
    element.style.setProperty('--example-viewport-top', `${viewport.offsetTop}px`);
  };
  resize();
  viewport.addEventListener('resize', resize);
  viewport.addEventListener('scroll', resize);
  destroyRef.onDestroy(() => {
    viewport.removeEventListener('resize', resize);
    viewport.removeEventListener('scroll', resize);
  });
}
