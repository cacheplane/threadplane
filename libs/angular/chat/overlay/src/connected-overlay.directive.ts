// libs/angular/chat/overlay/src/connected-overlay.directive.ts
/* eslint-disable @angular-eslint/no-input-rename, @angular-eslint/no-output-rename --
 * The `chatOverlay*` binding aliases ARE the intended public API: they namespace
 * the directive's inputs/outputs under the `chatOverlay` prefix (mirroring Angular
 * CDK's `cdkConnectedOverlay*` convention) rather than exposing bare names like
 * `open`/`positions` on an `<ng-template>`. The internal property names stay
 * concise, so aliasing here is deliberate, not a rename to avoid. */
import {
  DestroyRef,
  Directive,
  ElementRef,
  type EmbeddedViewRef,
  TemplateRef,
  ViewContainerRef,
  DOCUMENT,
  effect,
  inject,
  input,
  output,
} from '@angular/core';
import { getOverlayContainer } from './overlay-container';
import { computeConnectedPosition, narrowViewport, type ConnectedPosition } from './connected-position';

/** Marks the anchor element a connected overlay positions against. */
@Directive({
  selector: '[chatOverlayOrigin]',
  standalone: true,
  exportAs: 'chatOverlayOrigin',
})
export class ChatOverlayOriginDirective {
  readonly elementRef = inject(ElementRef) as ElementRef<HTMLElement>;
}

const VIEWPORT_MARGIN = 8;

/**
 * Applied to an `<ng-template>`. When `chatOverlayOpen` is true, the template
 * content is portaled into the shared body-level overlay container and
 * positioned connected to `chatOverlayOrigin`, repositioning live on
 * scroll/resize. Closes on outside mousedown (via the `chatOverlayOutsideClick`
 * output) and Tab; returns focus to the origin when focus was inside the pane.
 *
 * NOTE: the directive does not own the open state — it only emits. To fully
 * close the overlay, consumers MUST handle BOTH `(chatOverlayOutsideClick)` and
 * `(chatOverlayDetach)`. Tab-close (and Escape, when the consumer routes it)
 * surface through `chatOverlayDetach`, so wiring only `chatOverlayOutsideClick`
 * leaves the overlay stuck open on Tab.
 */
@Directive({
  selector: '[chatConnectedOverlay]',
  standalone: true,
})
export class ChatConnectedOverlayDirective {
  readonly origin = input.required<ChatOverlayOriginDirective>({ alias: 'chatOverlayOrigin' });
  readonly open = input<boolean>(false, { alias: 'chatOverlayOpen' });
  readonly positions = input<ConnectedPosition[]>([], { alias: 'chatOverlayPositions' });
  readonly panelClass = input<string | string[]>('', { alias: 'chatOverlayPanelClass' });

  /** Emits the pane element once attached (consumers focus content from it). */
  readonly attached = output<HTMLElement>({ alias: 'chatOverlayAttached' });
  readonly outsideClick = output<MouseEvent>({ alias: 'chatOverlayOutsideClick' });
  readonly detached = output<void>({ alias: 'chatOverlayDetach' });

  private readonly templateRef = inject(TemplateRef<unknown>);
  private readonly viewContainerRef = inject(ViewContainerRef);
  private readonly document = inject(DOCUMENT);

  private pane: HTMLElement | null = null;
  private viewRef: EmbeddedViewRef<unknown> | null = null;
  private resizeObs: ResizeObserver | null = null;
  private rafId = 0;
  private previouslyFocused: HTMLElement | null = null;

  private readonly onScrollOrResize = () => this.scheduleReposition();
  private readonly onDocMouseDown = (e: MouseEvent) => {
    if (!this.pane) return;
    const path = e.composedPath();
    if (path.includes(this.pane) || path.includes(this.origin().elementRef.nativeElement)) return;
    this.outsideClick.emit(e);
  };
  private readonly onKeydown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !this.pane) return;
    const active = this.document.activeElement;
    if (this.pane.contains(active) || active === this.origin().elementRef.nativeElement) {
      this.detached.emit();
    }
  };

  constructor() {
    effect(() => {
      if (this.open()) this.attach();
      else this.dispose();
    });
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  private attach(): void {
    if (this.pane) return;
    const win = this.document.defaultView;
    if (!win) return; // SSR / detached document

    this.previouslyFocused = this.document.activeElement as HTMLElement | null;

    const pane = this.document.createElement('div');
    pane.className = 'chat-overlay-pane';
    for (const c of this.normalizePanelClass()) pane.classList.add(c);
    getOverlayContainer(this.document).appendChild(pane);

    this.viewRef = this.viewContainerRef.createEmbeddedView(this.templateRef);
    this.viewRef.detectChanges();
    for (const node of this.viewRef.rootNodes) pane.appendChild(node as Node);

    this.pane = pane;
    this.reposition();

    win.addEventListener('scroll', this.onScrollOrResize, { capture: true, passive: true });
    win.addEventListener('resize', this.onScrollOrResize, { passive: true });
    this.document.addEventListener('mousedown', this.onDocMouseDown, true);
    this.document.addEventListener('keydown', this.onKeydown, true);
    if (typeof win.ResizeObserver === 'function') {
      this.resizeObs = new win.ResizeObserver(() => this.scheduleReposition());
      this.resizeObs.observe(this.origin().elementRef.nativeElement);
      this.resizeObs.observe(pane);
    }

    this.attached.emit(pane);
  }

  private scheduleReposition(): void {
    const win = this.document.defaultView;
    if (!win || !this.pane) return;
    if (this.rafId) win.cancelAnimationFrame(this.rafId);
    this.rafId = win.requestAnimationFrame(() => this.reposition());
  }

  private reposition(): void {
    const win = this.document.defaultView;
    if (!win || !this.pane) return;
    const r = this.pane.getBoundingClientRect();
    const result = computeConnectedPosition({
      originRect: this.origin().elementRef.nativeElement.getBoundingClientRect(),
      overlaySize: { width: r.width, height: r.height },
      viewport: narrowViewport(win, VIEWPORT_MARGIN),
      positions: this.positions(),
    });
    this.pane.style.top = `${Math.round(result.top)}px`;
    this.pane.style.left = `${Math.round(result.left)}px`;
  }

  private dispose(): void {
    const win = this.document.defaultView;
    if (this.rafId && win) win.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    if (win) {
      win.removeEventListener('scroll', this.onScrollOrResize, { capture: true } as EventListenerOptions);
      win.removeEventListener('resize', this.onScrollOrResize);
    }
    this.document.removeEventListener('mousedown', this.onDocMouseDown, true);
    this.document.removeEventListener('keydown', this.onKeydown, true);
    this.resizeObs?.disconnect();
    this.resizeObs = null;

    const focusWasInPane = !!this.pane && this.pane.contains(this.document.activeElement);
    this.viewRef?.destroy();
    this.viewRef = null;
    this.pane?.remove();
    this.pane = null;

    if (focusWasInPane && this.previouslyFocused) this.previouslyFocused.focus();
    this.previouslyFocused = null;
  }

  private normalizePanelClass(): string[] {
    const pc = this.panelClass();
    return Array.isArray(pc) ? pc : pc ? [pc] : [];
  }
}
