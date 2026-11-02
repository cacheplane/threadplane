// libs/chat/src/lib/markdown/cacheplane-markdown-views.ts
import { views, type ViewRegistry } from '@threadplane/render';
import { MarkdownDocumentComponent } from './views/markdown-document.component';
import { MarkdownParagraphComponent } from './views/markdown-paragraph.component';
import { MarkdownHeadingComponent } from './views/markdown-heading.component';
import { MarkdownBlockquoteComponent } from './views/markdown-blockquote.component';
import { MarkdownListComponent } from './views/markdown-list.component';
import { MarkdownListItemComponent } from './views/markdown-list-item.component';
import { MarkdownCodeBlockComponent } from './views/markdown-code-block.component';
import { MarkdownThematicBreakComponent } from './views/markdown-thematic-break.component';
import { MarkdownTextComponent } from './views/markdown-text.component';
import { MarkdownEmphasisComponent } from './views/markdown-emphasis.component';
import { MarkdownStrongComponent } from './views/markdown-strong.component';
import { MarkdownStrikethroughComponent } from './views/markdown-strikethrough.component';
import { MarkdownInlineCodeComponent } from './views/markdown-inline-code.component';
import { MarkdownMathComponent } from './views/markdown-math.component';
import { MarkdownLinkComponent } from './views/markdown-link.component';
import { MarkdownAutolinkComponent } from './views/markdown-autolink.component';
import { MarkdownImageComponent } from './views/markdown-image.component';
import { MarkdownSoftBreakComponent } from './views/markdown-soft-break.component';
import { MarkdownHardBreakComponent } from './views/markdown-hard-break.component';
import { MarkdownCitationReferenceComponent } from './views/markdown-citation-reference.component';
import { MarkdownTableComponent } from './views/markdown-table.component';
import { MarkdownTableRowComponent } from './views/markdown-table-row.component';
import { MarkdownTableCellComponent } from './views/markdown-table-cell.component';
import { MarkdownHtmlComponent } from './views/markdown-html.component';

/**
 * Default view registry consumed by `<chat-streaming-md>`. Maps every
 * `MarkdownNode.type` emitted by `@cacheplane/partial-markdown@0.2` to its
 * corresponding Angular component.
 *
 * Override per-node-type via `withViews(cacheplaneMarkdownViews, { … })`.
 */
export const cacheplaneMarkdownViews: ViewRegistry = views({
  'document':       MarkdownDocumentComponent,
  'paragraph':      MarkdownParagraphComponent,
  'heading':        MarkdownHeadingComponent,
  'blockquote':     MarkdownBlockquoteComponent,
  'list':           MarkdownListComponent,
  'list-item':      MarkdownListItemComponent,
  'code-block':     MarkdownCodeBlockComponent,
  'thematic-break': MarkdownThematicBreakComponent,
  'text':           MarkdownTextComponent,
  'emphasis':       MarkdownEmphasisComponent,
  'strong':         MarkdownStrongComponent,
  'strikethrough':  MarkdownStrikethroughComponent,
  'inline-code':    MarkdownInlineCodeComponent,
  'math-inline':    MarkdownMathComponent,
  'math-display':   MarkdownMathComponent,
  'link':           MarkdownLinkComponent,
  'autolink':       MarkdownAutolinkComponent,
  'image':          MarkdownImageComponent,
  'soft-break':     MarkdownSoftBreakComponent,
  'hard-break':     MarkdownHardBreakComponent,
  'citation-reference': MarkdownCitationReferenceComponent,
  'table':          MarkdownTableComponent,
  'table-row':      MarkdownTableRowComponent,
  'table-cell':     MarkdownTableCellComponent,
  // Raw HTML (added by partial-markdown 0.4.x) renders as escaped literal text
  // — XSS-safe, and matches the pre-0.4 behavior where HTML was plain text.
  'html-block':     MarkdownHtmlComponent,
  'html-inline':    MarkdownHtmlComponent,
});
