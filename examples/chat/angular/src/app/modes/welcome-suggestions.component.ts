import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import {
  ChatWelcomeSuggestionComponent,
} from '@threadplane/angular/chat';
import {
  ChatSelectComponent,
  type ChatSelectOption,
} from '@threadplane/angular/chat/select';
import { suggestionsForAppMode } from './welcome-suggestions';

/**
 * Demo-side composition that renders the welcome-state suggestion surface
 * as a single featured chip + a "More prompts" dropdown for everything
 * else. The featured chip is `FEATURED_SUGGESTIONS[0]` — consumer
 * controls which prompt is featured by ordering the array.
 *
 * Output `(selected)` fires with the suggestion's `value` for BOTH chip
 * clicks and dropdown picks — consumers wire it directly to
 * `agent.submit({ message: $event })` for auto-send semantics.
 */
@Component({
  selector: 'welcome-suggestions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatWelcomeSuggestionComponent, ChatSelectComponent],
  template: `
    <div class="welcome-suggestions__row">
      <chat-welcome-suggestion
        class="welcome-suggestions__featured"
        [label]="featuredOne().label"
        [value]="featuredOne().value"
        [description]="featuredOne().description"
        (selected)="selected.emit($event)"
      />
      <chat-select
        [options]="moreOptions()"
        placeholder="More prompts"
        menuLabel="More demo prompts"
        panelClass="welcome-suggestions__menu-panel"
        (valueChange)="selected.emit($event)"
      />
    </div>
  `,
  styles: [
    `
      :host {
        display: flex;
        justify-content: center;
        width: 100%;
        padding: 0 12px;
        box-sizing: border-box;
      }
      .welcome-suggestions__row {
        display: flex;
        align-items: center;
        gap: 12px;
        max-width: 100%;
      }
      .welcome-suggestions__featured {
        flex: 1 1 0;
        min-width: 0;
        max-width: 380px;
        overflow: hidden;
      }
      /* chat-welcome-suggestion host is display: inline-block by default
       * (sizes to content). At narrow viewports this lets the inner
       * button overflow the wrapper and get clipped at the wrapper's
       * right edge ("hard right border"). Force block sizing here so
       * the host follows the wrapper's flex-shrunk width and the
       * label inside ellipsizes. */
      .welcome-suggestions__featured ::ng-deep chat-welcome-suggestion {
        display: block;
        width: 100%;
      }
      .welcome-suggestions__featured ::ng-deep .chat-welcome-suggestion {
        width: 100%;
      }
      .welcome-suggestions__featured ::ng-deep .chat-welcome-suggestion__label {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        min-width: 0;
        flex: 1 1 auto;
      }
      /* Make the "More prompts" dropdown match the featured chip visually.
         Scoped to .welcome-suggestions__row so the model picker (also
         chat-select, elsewhere) is untouched. */
      .welcome-suggestions__row ::ng-deep chat-select .chat-select__trigger {
        height: auto;
        padding: 10px 16px;
        background: var(--tplane-chat-surface);
        color: var(--tplane-chat-text);
        border: 1px solid var(--tplane-chat-separator);
        border-radius: 9999px;
        font-size: var(--tplane-chat-font-size-sm);
      }
      .welcome-suggestions__row ::ng-deep chat-select .chat-select__trigger:hover:not(:disabled) {
        background: var(--tplane-chat-surface-alt);
        border-color: var(--tplane-chat-text-muted);
        color: var(--tplane-chat-text);
      }
      /* The menu portals to a body-level CDK overlay pane, so it's no longer a
         descendant of <chat-select>. Target the overlay panelClass instead.
         ::ng-deep here intentionally emits a global rule (the pane is outside
         this component's view). */
      ::ng-deep .welcome-suggestions__menu-panel .chat-select__menu {
        min-width: 320px;
        max-width: 480px;
        width: max-content;
      }
      .welcome-suggestions__row > chat-select {
        flex: 0 0 auto;
      }
    `,
  ],
})
export class WelcomeSuggestionsComponent {
  readonly selected = output<string>();
  /**
   * When true, lead with the trip-planning starters (App mode / map cockpit on
   * screen). When false, keep this demo's broad capability prompts (plain chat).
   * Passed by each mode from `shell.appMode()`.
   */
  readonly appModeOn = input<boolean>(false);

  /**
   * Optional `?featured=` id. A KEY into the curated list, never free text —
   * an unrecognised id falls back to the default rather than rendering it.
   */
  readonly featuredId = input<string | undefined>(undefined);

  private readonly suggestions = computed(() =>
    suggestionsForAppMode(this.appModeOn(), this.featuredId()),
  );
  protected readonly featuredOne = computed(() => this.suggestions().featured);
  protected readonly moreOptions = computed<readonly ChatSelectOption[]>(() =>
    this.suggestions().more.map((s) => ({ value: s.value, label: s.label, description: s.description })),
  );
}
