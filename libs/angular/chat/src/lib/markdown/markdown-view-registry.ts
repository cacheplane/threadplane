// libs/angular/chat/src/lib/markdown/markdown-view-registry.ts
import { InjectionToken } from '@angular/core';
import type { ViewRegistry } from '@threadplane/angular/render';

/**
 * DI token for the markdown view registry consumed by <chat-streaming-md>
 * and <md-children>. Maps MarkdownNode.type strings (e.g. "paragraph",
 * "heading") to Angular components that render that node type.
 *
 * `<chat-streaming-md>` provides the resolved registry on its component-level
 * injector so descendant <md-children> components resolve the right component
 * for each node. It resolves most-specific-first: the `[viewRegistry]` input,
 * then a registry provided by an ancestor injector (application root or route),
 * then `cacheplaneMarkdownViews` (the default). Providing this token at the
 * application root is therefore a supported app-wide override.
 */
export const MARKDOWN_VIEW_REGISTRY = new InjectionToken<ViewRegistry>(
  'MARKDOWN_VIEW_REGISTRY',
);
