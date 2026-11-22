// libs/angular/chat/citations/src/chat-citations-card.component.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Citation } from '@threadplane/core';
import { citationSourceVisual, citationTypeMeta, deriveDomain } from './citation-display';
import type { CitationTypeIcon } from './citation-display';
import { ɵCHAT_HOST_TOKENS as CHAT_HOST_TOKENS } from '@threadplane/angular/chat/shared';
import { CHAT_CITATION_SOURCE_VISUAL_STYLES, CHAT_CITATIONS_PANEL_STYLES } from './chat-citations.styles';
import { ɵinjectChatRuntime as injectChatRuntime } from '@threadplane/angular/chat/shared';

/**
 * Sources-panel detail card: index badge, favicon/monogram + domain + type,
 * title, one-line snippet. Renders as an <a> (opens the source) when a url is
 * present, otherwise a non-interactive <div>. Shares the panel style module.
 */
@Component({
  selector: 'chat-citations-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  styles: [CHAT_HOST_TOKENS, CHAT_CITATION_SOURCE_VISUAL_STYLES, CHAT_CITATIONS_PANEL_STYLES],
  template: `
    @if (citation().url; as url) {
      <a class="chat-citations-card" [href]="url" target="_blank" rel="noopener noreferrer"
         [attr.aria-label]="'Source ' + citation().index + ': ' + (citation().title ?? url)">
        <ng-container [ngTemplateOutlet]="inner" />
      </a>
    } @else {
      <div class="chat-citations-card">
        <ng-container [ngTemplateOutlet]="inner" />
      </div>
    }

    <ng-template #inner>
      <span class="chat-citations-card__index">{{ citation().index }}</span>
      <span class="chat-citations-card__body">
        <span class="chat-citations-card__top">
          @if (sourceIconUrl(); as icon) {
            <img class="chat-citations-card__fav" [src]="icon" alt="" width="14" height="14" />
          } @else if (sourceIcon(); as icon) {
            <span class="chat-citation-source-icon chat-citation-source-icon--sm chat-citations-card__source-icon"
                  aria-hidden="true"
                  [class.chat-citation-source-icon--web]="icon === 'web'"
                  [class.chat-citation-source-icon--file]="icon === 'file'"
                  [class.chat-citation-source-icon--app]="icon === 'app'"
                  [class.chat-citation-source-icon--memory]="icon === 'memory'"
                  [class.chat-citation-source-icon--generic]="icon === 'generic'">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                @switch (icon) {
                  @case ('file') {
                    <path d="M7 3.5h6.5L18 8v12.5H7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                    <path d="M13.5 3.5V8H18M9.5 13h5M9.5 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  }
                  @case ('app') {
                    <rect x="4" y="5" width="16" height="14" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M8 9h.01M11.5 9h.01M15 9h.01M8 12.5h8M8 16h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  }
                  @case ('memory') {
                    <path d="M8 7.5a4 4 0 0 1 8 0v9a4 4 0 0 1-8 0z" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M12 4v16M8 10h8M8 14h8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  }
                  @case ('web') {
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8" />
                    <path d="M4.5 12h15M12 4a12 12 0 0 1 0 16M12 4a12 12 0 0 0 0 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  }
                  @default {
                    <path d="M6 5.5h12v13H6z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
                    <path d="M9 9h6M9 12h6M9 15h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" />
                  }
                }
              </svg>
            </span>
          } @else {
            <span class="chat-citations-card__fav chat-citations-card__fav--mono"
                  [style.background]="sourceMonoColor()">{{ sourceMonogram() }}</span>
          }
          @if (domain(); as d) { <span class="chat-citations-card__domain">{{ d }}</span> }
          @if (typeLabel(); as t) {
            <span class="chat-citations-card__type chat-citation-type-badge"
                  [class.chat-citation-type-badge--web]="isTypeTone('web')"
                  [class.chat-citation-type-badge--file]="isTypeTone('file')"
                  [class.chat-citation-type-badge--app]="isTypeTone('app')"
                  [class.chat-citation-type-badge--memory]="isTypeTone('memory')"
                  [class.chat-citation-type-badge--generic]="isTypeTone('generic')">{{ t }}</span>
          }
        </span>
        @if (title(); as t) {
          <span class="chat-citations-card__title">{{ t }}</span>
        }
        @if (citation().snippet; as s) {
          <span class="chat-citations-card__snippet">{{ s }}</span>
        }
      </span>
    </ng-template>
  `,
})
export class ChatCitationsCardComponent {
  protected readonly chatRuntime = injectChatRuntime();
  readonly citation = input.required<Citation>();

  private readonly sourceVisual = computed(() => citationSourceVisual(this.citation()));
  private readonly typeMeta = computed(() => citationTypeMeta(this.citation()));

  protected readonly domain = computed(() => deriveDomain(this.citation().url));
  protected readonly title = computed(() => this.citation().title ?? this.citation().url ?? null);
  protected readonly sourceIconUrl = computed(() => {
    const visual = this.sourceVisual();
    return visual.kind === 'image' ? visual.iconUrl : null;
  });
  protected readonly sourceIcon = computed((): CitationTypeIcon | null => {
    const visual = this.sourceVisual();
    return visual.kind === 'type-icon' ? visual.icon : null;
  });
  protected readonly sourceMonogram = computed(() => {
    const visual = this.sourceVisual();
    return visual.kind === 'monogram' ? visual.monogram : null;
  });
  protected readonly sourceMonoColor = computed(() => {
    const visual = this.sourceVisual();
    return visual.kind === 'monogram' ? visual.color : null;
  });
  protected readonly typeLabel = computed(() => this.typeMeta().label);
  protected readonly typeTone = computed(() => this.typeMeta().tone);

  protected isTypeTone(tone: CitationTypeIcon): boolean {
    return this.typeTone() === tone;
  }
}
