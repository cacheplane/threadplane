// Citations: the sources panel, source cards, previews, inline citation markers
// and the helpers that describe a source. `<chat>` loads them on demand, the
// first time a message cites a source.
export { ChatCitationsComponent, ChatCitationCardTemplateDirective } from './src/chat-citations.component';
export { ChatCitationsCardComponent } from './src/chat-citations-card.component';
export { ChatCitationPreviewComponent } from './src/chat-citation-preview.component';
export { MarkdownCitationReferenceComponent } from './src/markdown-citation-reference.component';
export {
  deriveDomain, deriveSourceType, deriveMonogram, monogramHue, monogramColor, citationTypeLabel,
  citationTypeMeta, citationSourceVisual, formatPublished,
} from './src/citation-display';
export type {
  CitationTypeIcon, CitationTypeMeta, CitationSourceVisual,
  CitationImageVisual, CitationTypeIconVisual, CitationMonogramVisual,
} from './src/citation-display';
