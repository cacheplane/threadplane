// libs/chat/src/lib/primitives/chat-citations/chat-citations.component.ts
import {
  ChangeDetectionStrategy, Component, ContentChild, Directive, TemplateRef,
  computed, inject, input, signal,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import type { Message } from '../../agent/message';
import type { Citation } from '../../agent/citation';
import { ChatCitationsCardComponent } from './chat-citations-card.component';
import { CitationsResolverService, mdDefToCitation } from '../../markdown/citations-resolver.service';
import { citationSourceVisual } from '../../agent/citation-display';
import type { CitationTypeIcon } from '../../agent/citation-display';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_CITATIONS_PANEL_STYLES } from '../../styles/chat-citations.styles';

/**
 * ContentChild template directive for custom citation card rendering.
 *
 * ```html
 * <ng-template chatCitationCard let-citation>...</ng-template>
 * ```
 */
@Directive({ selector: 'ng-template[chatCitationCard]', standalone: true })
export class ChatCitationCardTemplateDirective {
  readonly tpl = inject<TemplateRef<{ $implicit: Citation }>>(TemplateRef);
}

interface FavEntry {
  id: string;
  kind: 'image' | 'type-icon' | 'monogram';
  iconUrl?: string;
  icon?: CitationTypeIcon;
  tone?: CitationTypeIcon;
  monogram?: string;
  color?: string;
}

let nextCitationsId = 0;

/** Renders an expandable sources panel combining message citations with markdown citation definitions. */
@Component({
  selector: 'chat-citations',
  standalone: true,
  imports: [NgTemplateOutlet, ChatCitationsCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_CITATIONS_PANEL_STYLES],
  template: `
    @if (citations().length > 0) {
      <section class="chat-citations">
        <button
          type="button"
          class="chat-citations__header"
          [attr.aria-expanded]="expanded()"
          [attr.aria-controls]="listId"
          (click)="expanded.set(!expanded())"
        >
          <span class="chat-citations__heading">{{ heading() }}</span>
          <span class="chat-citations__count">{{ citations().length }}</span>
          <span class="chat-citations__favstack" aria-hidden="true">
            @for (f of favstack(); track f.id) {
              @if (f.kind === 'image' && f.iconUrl) {
                <img class="chat-citations__fav" [src]="f.iconUrl" alt="" width="16" height="16" />
              } @else if (f.kind === 'type-icon' && f.icon) {
                <span class="chat-citation-source-icon chat-citations__source-icon"
                      [class.chat-citation-source-icon--web]="f.tone === 'web'"
                      [class.chat-citation-source-icon--file]="f.tone === 'file'"
                      [class.chat-citation-source-icon--app]="f.tone === 'app'"
                      [class.chat-citation-source-icon--memory]="f.tone === 'memory'"
                      [class.chat-citation-source-icon--generic]="f.tone === 'generic'"
                      [class.chat-citations__source-icon--web]="f.icon === 'web'"
                      [class.chat-citations__source-icon--file]="f.icon === 'file'"
                      [class.chat-citations__source-icon--app]="f.icon === 'app'"
                      [class.chat-citations__source-icon--memory]="f.icon === 'memory'"
                      [class.chat-citations__source-icon--generic]="f.icon === 'generic'">
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    @switch (f.icon) {
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
                <span class="chat-citations__fav chat-citations__fav--mono"
                      [style.background]="f.color">{{ f.monogram }}</span>
              }
            }
          </span>
          <svg class="chat-citations__chevron" [class.is-open]="expanded()"
               viewBox="0 0 24 24" aria-hidden="true" width="15" height="15">
            <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
          </svg>
        </button>
        @if (expanded()) {
          <ul class="chat-citations__list" [id]="listId">
            @for (c of citations(); track c.id) {
              <li class="chat-citations__item">
                @if (cardTpl) {
                  <ng-container *ngTemplateOutlet="cardTpl.tpl; context: { $implicit: c }" />
                } @else {
                  <chat-citations-card [citation]="c" />
                }
              </li>
            }
          </ul>
        }
      </section>
    }
  `,
})
export class ChatCitationsComponent {
  readonly message = input.required<Message>();
  readonly heading = input<string>('Sources');

  protected readonly expanded = signal(false);
  protected readonly listId = `chat-citations-list-${nextCitationsId++}`;

  @ContentChild(ChatCitationCardTemplateDirective) cardTpl: ChatCitationCardTemplateDirective | null = null;

  private readonly resolver = inject(CitationsResolverService, { optional: true });

  /**
   * Combined citation list:
   *   1. Message.citations (provider-populated, takes precedence by id)
   *   2. Markdown sidecar defs (Pandoc [^id]: lines), merged for unseen ids.
   * Sorted by index ascending.
   */
  protected readonly citations = computed<Citation[]>(() => {
    const fromMessage = this.message().citations ?? [];
    const seenIds = new Set(fromMessage.map((c) => c.id));
    const fromMarkdown: Citation[] = [];
    const mdDefs = this.resolver?.markdownDefs();
    if (mdDefs) {
      for (const def of mdDefs.values()) {
        if (!seenIds.has(def.id)) fromMarkdown.push(mdDefToCitation(def));
      }
    }
    return [...fromMessage, ...fromMarkdown].sort((a, b) => a.index - b.index);
  });

  /** First 3 sources, mapped to favicon/monogram chips for the header preview. */
  protected readonly favstack = computed<FavEntry[]>(() =>
    this.citations().slice(0, 3).map((c) => ({ id: c.id, ...citationSourceVisual(c) })),
  );
}
