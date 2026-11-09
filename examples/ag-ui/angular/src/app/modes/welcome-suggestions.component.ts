import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ChatSelectComponent, type ChatSelectOption } from '@threadplane/chat';
import { suggestionsForAppMode } from './welcome-suggestions';

/** A readable featured prompt and the complete prompt catalog in a menu. */
@Component({
  selector: 'welcome-suggestions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ChatSelectComponent],
  template: `
    <div class="welcome-suggestions__row">
      <button
        type="button"
        class="welcome-suggestions__featured"
        [attr.aria-label]="featuredOne().label"
        [attr.aria-description]="featuredOne().description"
        (click)="selected.emit(featuredOne().value)"
      >
        <span class="welcome-suggestions__copy">
          <span class="welcome-suggestions__label">{{ featuredOne().label }}</span>
          <span class="welcome-suggestions__description">{{ featuredOne().description }}</span>
        </span>
        <svg class="welcome-suggestions__arrow" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.75" stroke-linecap="round"
          stroke-linejoin="round" aria-hidden="true">
          <path d="M5 12h14m-6-6 6 6-6 6" />
        </svg>
      </button>
      <chat-select
        [options]="moreOptions()"
        placeholder="More prompts"
        menuLabel="More demo prompts"
        panelClass="welcome-suggestions__menu-panel"
        (valueChange)="selected.emit($event)"
      />
    </div>
  `,
  styles: [`
    :host {
      display: block;
      width: min(100%, 480px);
      padding: 0 12px;
      box-sizing: border-box;
    }
    .welcome-suggestions__row {
      display: grid;
      justify-items: center;
      gap: 12px;
      width: 100%;
      min-width: 0;
    }
    .welcome-suggestions__featured {
      display: flex;
      align-items: center;
      gap: 16px;
      width: 100%;
      min-width: 0;
      min-height: 44px;
      box-sizing: border-box;
      padding: 16px;
      border: 1px solid var(--demo-control-border);
      border-radius: 12px;
      background: var(--demo-control-surface);
      color: var(--demo-control-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .welcome-suggestions__copy { display: grid; gap: 4px; min-width: 0; flex: 1; }
    .welcome-suggestions__label {
      font-size: 14px;
      font-weight: 600;
      line-height: 1.4;
      overflow-wrap: anywhere;
    }
    .welcome-suggestions__description {
      color: var(--demo-control-muted);
      font-size: 12px;
      line-height: 1.5;
      overflow-wrap: anywhere;
    }
    .welcome-suggestions__arrow { width: 18px; height: 18px; flex: 0 0 18px; }
    .welcome-suggestions__featured:hover { border-color: var(--demo-control-muted); }
    .welcome-suggestions__featured:focus-visible {
      outline: 2px solid var(--demo-control-focus);
      outline-offset: 3px;
    }
    .welcome-suggestions__row > chat-select { max-width: 100%; }
    .welcome-suggestions__row ::ng-deep .chat-select__trigger {
      min-height: 44px;
      height: auto;
      box-sizing: border-box;
      padding: 8px 16px;
      border: 1px solid var(--demo-control-border);
      border-radius: 8px;
      background: var(--demo-control-bg);
      color: var(--demo-control-text);
      font-size: 13px;
    }
    .welcome-suggestions__row ::ng-deep .chat-select__trigger:hover:not(:disabled) {
      background: var(--demo-control-surface);
      color: var(--demo-control-text);
    }
    .welcome-suggestions__row ::ng-deep .chat-select__trigger:focus-visible {
      outline: 2px solid var(--demo-control-focus);
      outline-offset: 3px;
    }
    /* The menu is portaled outside this component; the class scopes only this catalog. */
    ::ng-deep .welcome-suggestions__menu-panel .chat-select__menu {
      width: min(400px, calc(100vw - 32px));
      min-width: 0;
      max-width: calc(100vw - 32px);
      max-height: min(360px, calc(100dvh - 32px));
      border-color: var(--demo-control-border);
      background: var(--demo-control-bg);
      overscroll-behavior: contain;
    }
    ::ng-deep .welcome-suggestions__menu-panel .chat-select__option {
      min-height: 44px;
      padding: 12px;
      color: var(--demo-control-text);
      white-space: normal;
      overflow-wrap: anywhere;
    }
    ::ng-deep .welcome-suggestions__menu-panel .chat-select__option-desc {
      color: var(--demo-control-muted);
      line-height: 1.5;
    }
    ::ng-deep .welcome-suggestions__menu-panel .chat-select__option:is(:hover, :focus-visible) {
      background: var(--demo-control-surface);
    }
    ::ng-deep .welcome-suggestions__menu-panel .chat-select__option:focus-visible {
      outline: 2px solid var(--demo-control-focus);
      outline-offset: -2px;
    }
  `],
})
export class WelcomeSuggestionsComponent {
  readonly selected = output<string>();
  /**
   * When true, lead with the itinerary prompts (App mode / map cockpit on
   * screen). When false, lead with the broad capability prompts (plain chat).
   * Passed by each mode from `shell.appMode()`.
   */
  readonly appModeOn = input<boolean>(false);

  private readonly suggestions = computed(() => suggestionsForAppMode(this.appModeOn()));
  protected readonly featuredOne = computed(() => this.suggestions().featured);
  protected readonly moreOptions = computed<readonly ChatSelectOption[]>(() =>
    this.suggestions().more.map((s) => ({ value: s.value, label: s.label, description: s.description })),
  );
}
