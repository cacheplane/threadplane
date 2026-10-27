import {
  ChangeDetectionStrategy,
  Component,
  input,
  signal,
} from '@angular/core';
import { markdownUrl, type MarkdownNode } from '@threadplane/content/markdown';

/** The caller keys this local failure state by destination and generation. */
@Component({
  selector: 'threadplane-markdown-image',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (url(); as destination) { @if (!failed()) {
    <img
      [src]="destination"
      [alt]="image().alt"
      [title]="image().title"
      (error)="failed.set(true)"
    />
    } @else {
    <span role="img" [attr.aria-label]="image().alt || 'Image unavailable'">{{
      image().alt || 'Image unavailable'
    }}</span>
    } } @else {
    <span role="img" [attr.aria-label]="image().alt || 'Image unavailable'">{{
      image().alt || 'Image unavailable'
    }}</span>
    }
  `,
})
export class MarkdownImageComponent {
  readonly image = input.required<Extract<MarkdownNode, { type: 'image' }>>();
  protected readonly failed = signal(false);
  protected url() {
    return markdownUrl(this.image().url, 'image');
  }
}
