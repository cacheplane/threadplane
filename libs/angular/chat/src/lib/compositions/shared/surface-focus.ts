import {
  afterRenderEffect,
  ElementRef,
  inject,
  type Signal,
} from '@angular/core';

/** Preserve a non-modal surface's contents while transferring keyboard focus. */
export function installChatSurfaceFocus(
  open: Signal<boolean>,
  panelSelector: string,
  closeSelector: string,
  launcherSelector: string
): void {
  const host = inject<ElementRef<HTMLElement>>(ElementRef, {
    optional: true,
  })?.nativeElement;
  if (!host) return;
  let wasOpen = false;
  afterRenderEffect(() => {
    const isOpen = open();
    if (isOpen === wasOpen) return;
    wasOpen = isOpen;
    if (isOpen) {
      host.querySelector<HTMLElement>(closeSelector)?.focus();
    } else {
      const active = host.ownerDocument.activeElement;
      if (
        active === host.ownerDocument.body ||
        (active && host.querySelector(panelSelector)?.contains(active))
      ) {
        host.querySelector<HTMLElement>(launcherSelector)?.focus();
      }
    }
  });
}
