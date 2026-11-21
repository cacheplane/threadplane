import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { ChatStreamingMdComponent } from '../../streaming/streaming-markdown.component';
import type { OwnedMarkdownContext } from './owned-markdown-context';

/** Owns default markdown on the existing body element, without a layout host. */
@Component({
  selector: '[chatOwnedMarkdownBody]',
  standalone: true,
  imports: [ChatStreamingMdComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-content select="[chatBeforeMarkdown]" />
    @if (context()?.document(); as document) {
      <chat-streaming-md [document]="document" />
    }
    <ng-content select="[chatAfterMarkdown]" />
    <ng-content />
    <ng-content select="[chatMarkdownCaret]" />
  `,
})
export class OwnedMarkdownBodyComponent {
  readonly context = input<OwnedMarkdownContext | null>(null, { alias: 'chatOwnedMarkdownBody' });
}
