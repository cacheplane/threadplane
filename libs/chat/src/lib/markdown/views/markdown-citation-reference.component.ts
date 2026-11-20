// libs/chat/src/lib/markdown/views/markdown-citation-reference.component.ts
import {
  ChangeDetectionStrategy, Component, DestroyRef, DOCUMENT, computed, inject, input, signal,
} from '@angular/core';
import type { MarkdownCitationReferenceNode } from '@cacheplane/partial-markdown';
import { CitationsResolverService } from '../citations-resolver.service';
import {
  ChatConnectedOverlayDirective, ChatOverlayOriginDirective,
} from '../../primitives/overlay/connected-overlay.directive';
import type { ConnectedPosition } from '../../primitives/overlay/connected-position';
import { ChatCitationPreviewComponent } from '../../primitives/chat-citations/chat-citation-preview.component';
import { deriveDomain } from '../../agent/citation-display';
import type { Citation } from '../../agent';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_CITATION_MARKER_STYLES } from '../../styles/chat-citations.styles';

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 200;

/**
 * Inline citation marker. Renders a numbered pill and reveals a provenance
 * preview card (portaled via the connected-overlay primitive) on hover/focus
 * (desktop) or tap (touch). Click navigates on desktop when a url exists;
 * on touch it previews instead of navigating.
 */
@Component({
  selector: 'chat-md-citation-reference',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatConnectedOverlayDirective, ChatOverlayOriginDirective, ChatCitationPreviewComponent],
  styles: [CHAT_HOST_TOKENS, CHAT_CITATION_MARKER_STYLES],
  template: `
    @if (resolved(); as r) {
      <a
        class="chat-citation-marker"
        [class.chat-citation-marker--no-url]="!r.citation.url"
        chatOverlayOrigin
        #origin="chatOverlayOrigin"
        [attr.href]="r.citation.url ?? null"
        [attr.target]="r.citation.url ? '_blank' : null"
        [attr.rel]="r.citation.url ? 'noopener noreferrer' : null"
        [attr.role]="r.citation.url ? null : 'button'"
        [attr.tabindex]="r.citation.url ? null : '0'"
        aria-haspopup="dialog"
        [attr.aria-expanded]="open()"
        [attr.aria-label]="ariaLabel(r.citation)"
        (mouseenter)="onEnter()"
        (mouseleave)="onLeave()"
        (focus)="onFocus()"
        (blur)="onBlur()"
        (click)="onClick($event, r.citation)"
        (keydown)="onKeydown($event, r.citation)"
      >{{ node().index }}</a>
      <ng-template
        chatConnectedOverlay
        [chatOverlayOrigin]="origin"
        [chatOverlayOpen]="open()"
        [chatOverlayPositions]="positions"
        [chatOverlayPanelClass]="'chat-citation-preview-pane'"
        (chatOverlayAttached)="onAttached($event)"
        (chatOverlayOutsideClick)="close()"
        (chatOverlayDetach)="close()"
      >
        <chat-citation-preview [citation]="r.citation" />
      </ng-template>
    } @else {
      <span
        class="chat-citation-marker chat-citation-marker--unresolved"
        [attr.title]="'No source available'"
        [attr.aria-label]="'Citation ' + node().index + ': source unavailable'"
      >{{ node().index }}</span>
    }
  `,
})
export class MarkdownCitationReferenceComponent {
  readonly node = input.required<MarkdownCitationReferenceNode>();

  private readonly resolver = inject(CitationsResolverService);
  private readonly document = inject(DOCUMENT);

  protected readonly resolved = computed(() => this.resolver.lookup(this.node().refId)());
  protected readonly open = signal(false);

  // Prefer below-start, flip above when it won't fit. The positioner clamps to view.
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
  ];

  /** Read fresh each time: SSR renders with no window, and hybrid devices change. */
  private get hoverCapable(): boolean {
    return this.document.defaultView?.matchMedia?.('(hover: hover) and (pointer: fine)').matches ?? false;
  }

  private openTimer = 0;
  private closeTimer = 0;
  private pane: HTMLElement | null = null;
  private justOpenedByFocus = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimers());
  }

  protected ariaLabel(c: Citation): string {
    const domain = deriveDomain(c.url);
    const parts = [`Source ${c.index}`];
    if (c.title) parts.push(c.title);
    if (domain) parts.push(domain);
    const base = parts.join(', ');
    return c.url ? `${base}, opens in new tab` : base;
  }

  protected onEnter(): void {
    if (!this.hoverCapable) return;
    this.cancelClose();
    const win = this.document.defaultView;
    if (win) this.openTimer = win.setTimeout(() => this.open.set(true), OPEN_DELAY_MS);
  }

  protected onLeave(): void {
    if (!this.hoverCapable) return;
    this.cancelOpen();
    this.scheduleClose();
  }

  protected onFocus(): void {
    this.open.set(true);
    this.justOpenedByFocus = true;
  }

  protected onBlur(): void {
    this.justOpenedByFocus = false;
    const active = this.document.activeElement;
    if (this.pane && active && this.pane.contains(active)) return; // focus moved into card
    this.close();
  }

  protected onClick(e: MouseEvent, c: Citation): void {
    // Desktop + real url: let the native link navigate.
    if (this.hoverCapable && c.url) return;
    // No url, or touch device: preview instead of navigating.
    e.preventDefault();
    if (this.justOpenedByFocus) {
      // focus (fired first in this tap/gesture) already opened it — don't toggle closed
      this.justOpenedByFocus = false;
      return;
    }
    this.open.update((v) => !v);
  }

  protected onKeydown(e: KeyboardEvent, c: Citation): void {
    if (e.key === 'Escape') {
      this.close();
      return;
    }
    // A no-url marker is a button: Enter/Space reveals the preview (Escape/blur close it).
    if (!c.url && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      this.open.set(true);
    }
  }

  protected onAttached(pane: HTMLElement): void {
    this.pane = pane;
    pane.addEventListener('mouseenter', this.onPaneEnter);
    pane.addEventListener('mouseleave', this.onPaneLeave);
  }

  protected close(): void {
    this.clearTimers();
    this.justOpenedByFocus = false;
    this.open.set(false);
    this.pane = null; // directive removes the pane element on detach
  }

  private readonly onPaneEnter = () => this.cancelClose();
  private readonly onPaneLeave = () => this.scheduleClose();

  private scheduleClose(): void {
    const win = this.document.defaultView;
    if (win) this.closeTimer = win.setTimeout(() => this.open.set(false), CLOSE_DELAY_MS);
  }

  private cancelOpen(): void {
    const win = this.document.defaultView;
    if (this.openTimer && win) win.clearTimeout(this.openTimer);
    this.openTimer = 0;
  }

  private cancelClose(): void {
    const win = this.document.defaultView;
    if (this.closeTimer && win) win.clearTimeout(this.closeTimer);
    this.closeTimer = 0;
  }

  private clearTimers(): void {
    this.cancelOpen();
    this.cancelClose();
  }
}
