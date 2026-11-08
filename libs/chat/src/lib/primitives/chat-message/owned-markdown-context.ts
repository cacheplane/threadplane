import { Directive, input, type Signal } from '@angular/core';
import type { ContentClassifier } from '../../streaming/content-classifier';
import type { StreamingMarkdownDocument } from '../../streaming/streaming-markdown.component';

/** Private composition-to-body bridge; raw message inputs remain independent. */
export interface OwnedMarkdownContext {
  readonly classifier: Signal<ContentClassifier>;
  readonly content: Signal<string>;
  readonly document: Signal<StreamingMarkdownDocument | null>;
}

@Directive({ selector: 'chat-message[chatOwnedMarkdownContext]', standalone: true })
export class OwnedMarkdownContextDirective {
  readonly context = input.required<OwnedMarkdownContext>({ alias: 'chatOwnedMarkdownContext' });
}
