// libs/chat/src/lib/markdown/views/markdown-image.component.ts
import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import type { MarkdownImageNode } from '@cacheplane/partial-markdown';

/** Renders a markdown image with an accessible fallback when the image fails to load. */
@Component({
  selector: 'chat-md-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (failed()) {
      <span class="chat-md-image chat-md-image--broken"
            role="img"
            [attr.aria-label]="node().alt || node().url"
            [attr.title]="node().title || node().url || null">
        <span class="chat-md-image__icon" aria-hidden="true">🖼️</span>
        @if (node().alt) {
          <span class="chat-md-image__alt">{{ node().alt }}</span>
        } @else {
          <span class="chat-md-image__alt">image unavailable</span>
        }
      </span>
    } @else {
      <img
        [src]="node().url"
        [alt]="node().alt"
        [attr.title]="node().title || null"
        (error)="failed.set(true)"
      />
    }
  `,
})
export class MarkdownImageComponent {
  readonly node = input.required<MarkdownImageNode>();
  protected readonly failed = signal(false);
}
