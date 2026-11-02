// libs/chat/src/lib/markdown/views/markdown-autolink.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import type { MarkdownAutolinkNode } from '@cacheplane/partial-markdown';

/** Renders a markdown autolink node as a link whose label is its URL. */
@Component({
  selector: 'chat-md-autolink',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<a [href]="node().url">{{ node().url }}</a>`,
})
export class MarkdownAutolinkComponent {
  readonly node = input.required<MarkdownAutolinkNode>();
}
