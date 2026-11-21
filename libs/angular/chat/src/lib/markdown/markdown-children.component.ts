// libs/angular/chat/src/lib/markdown/markdown-children.component.ts
import {
  Component,
  ChangeDetectionStrategy,
  inject,
  input,
  computed,
  Type,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import type { ViewRegistry } from '@threadplane/angular/render';
import type { MarkdownNode } from '@cacheplane/partial-markdown';
import { MARKDOWN_VIEW_REGISTRY } from './markdown-view-registry';

/**
 * Recursively dispatches a parent node's children through the markdown view
 * registry. Each child's `type` is looked up in the registry; the resolved
 * component is rendered with `[node]` bound to that child.
 *
 * Position-stable: `track $index` avoids NG0956 re-creation warnings that
 * occur when the markdown pipeline re-parses content on every stream delta,
 * producing new child object references even for unchanged nodes.
 */
@Component({
  selector: 'chat-md-children',
  standalone: true,
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (child of children(); track $index) {
      @let comp = resolve(child);
      @if (comp) {
        <ng-container *ngComponentOutlet="comp; inputs: { node: child }" />
      }
    }
  `,
})
export class MarkdownChildrenComponent {
  readonly parent = input.required<MarkdownNode>();
  private readonly registry = inject<ViewRegistry>(MARKDOWN_VIEW_REGISTRY);

  protected readonly children = computed<readonly MarkdownNode[]>(() => {
    const p = this.parent();
    return 'children' in p && Array.isArray((p as { children?: MarkdownNode[] }).children)
      ? ((p as { children: MarkdownNode[] }).children as readonly MarkdownNode[])
      : [];
  });

  protected resolve(child: MarkdownNode): Type<unknown> | null {
    const entry = this.registry[child.type];
    if (!entry) return null;
    // ViewRegistry entries are either a bare Type or { component, fallback? }.
    return typeof entry === 'function' ? entry : entry.component;
  }
}
