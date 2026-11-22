// libs/angular/chat/src/lib/markdown/views/markdown-citation-reference-host.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { MarkdownCitationReferenceNode } from '@cacheplane/partial-markdown';
import { MarkdownCitationReferenceComponent } from '@threadplane/angular/chat/citations';

/**
 * The default view for an inline citation marker. The marker, its preview card
 * and the overlay behind it load on demand, with
 * `@threadplane/angular/chat/citations`, the first time a message cites a
 * source; until then the marker's number shows as plain text.
 */
@Component({
  selector: 'chat-md-citation-reference-host',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownCitationReferenceComponent],
  styles: [':host { display: contents; }'],
  template: `
    @defer (on immediate) {
      <chat-md-citation-reference [node]="node()" />
    } @placeholder {
      <span>{{ node().index }}</span>
    }
  `,
})
export class MarkdownCitationReferenceHostComponent {
  readonly node = input.required<MarkdownCitationReferenceNode>();
}
