import {
  Directive,
  EmbeddedViewRef,
  inject,
  input,
  OnChanges,
  TemplateRef,
  ViewContainerRef,
} from '@angular/core';
import type {
  MarkdownDocumentNode,
  MarkdownNode,
} from '@threadplane/content/markdown';

interface MarkdownContext {
  $implicit: readonly MarkdownNode[];
  root: MarkdownDocumentNode;
  anchor: boolean;
  header: boolean;
}

/** Gives recursive template locals the readonly content-domain types. */
@Directive({ selector: 'ng-template[markdownNodes]', standalone: true })
export class MarkdownNodesDirective {
  static ngTemplateContextGuard(
    _directive: MarkdownNodesDirective,
    context: unknown
  ): context is MarkdownContext {
    return true;
  }
}

/** A retained, hostless Markdown view; context changes never recreate its DOM. */
@Directive({ selector: '[markdownOutlet]', standalone: true })
export class MarkdownOutletDirective implements OnChanges {
  readonly markdownOutlet = input.required<TemplateRef<MarkdownContext>>();
  readonly markdownContext = input.required<MarkdownContext>();
  private readonly container = inject(ViewContainerRef);
  private template: TemplateRef<MarkdownContext> | undefined;
  private view: EmbeddedViewRef<MarkdownContext> | undefined;

  ngOnChanges(): void {
    const template = this.markdownOutlet();
    const context = this.markdownContext();
    if (!this.view || this.template !== template) {
      this.container.clear();
      this.template = template;
      this.view = this.container.createEmbeddedView(template, { ...context });
    } else {
      Object.assign(this.view.context, context);
      this.view.markForCheck();
    }
  }
}
