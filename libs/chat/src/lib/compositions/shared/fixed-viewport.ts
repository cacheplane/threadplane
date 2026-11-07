import { DestroyRef, ElementRef, inject } from '@angular/core';

/** Fixed chat surfaces must fit the area left visible by the software keyboard. */
export function installFixedChatViewport(): void {
  const element = inject<ElementRef<HTMLElement>>(ElementRef, {
    optional: true,
  })?.nativeElement;
  const viewport = element?.ownerDocument.defaultView?.visualViewport;
  if (!element || !viewport) return;
  const destroyRef = inject(DestroyRef);
  const update = () => {
    // Let the browser handle pinch zoom without reflowing the conversation.
    if (viewport.scale !== 1) return;
    element.style.setProperty(
      '--tplane-chat-viewport-height',
      `${viewport.height}px`
    );
    element.style.setProperty(
      '--tplane-chat-viewport-top',
      `${viewport.offsetTop}px`
    );
  };
  update();
  viewport.addEventListener('resize', update);
  viewport.addEventListener('scroll', update);
  destroyRef.onDestroy(() => {
    viewport.removeEventListener('resize', update);
    viewport.removeEventListener('scroll', update);
  });
}
