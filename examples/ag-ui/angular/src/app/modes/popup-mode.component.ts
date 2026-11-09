import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatPopupComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent, a2uiBasicCatalog } from '@threadplane/chat';
import { AgUiShell } from '../shell/ag-ui-shell.component';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';
import { AppModePromoComponent } from './app-mode-promo.component';

@Component({
  selector: 'popup-mode',
  standalone: true,
  imports: [ChatPopupComponent, WelcomeSuggestionsComponent, AppModePromoComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="popup-mode__background">
      <!-- The floating chat leaves room for the App-mode promo or map. -->
      @if (shell.appMode() !== 'on') {
        <app-mode-promo
          [hasMapsKey]="shell.hasMapsKey"
          (enable)="shell.onAppModeChange('on')"
        />
      }
    </div>
    <chat-popup
      [agent]="agent"
      [clientTools]="shell.clientTools"
      [views]="catalog"
      [modelOptions]="shell.modelOptions()"
      [selectedModel]="shell.model()"
      [showModelPicker]="false"
      (selectedModelChange)="shell.onModelChange($event)"
    >
      <ng-template chatInterruptTemplate let-agent>
        <chat-interrupt-panel [agent]="agent" (action)="shell.onInterruptAction($event)" />
      </ng-template>
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'" (selected)="send($event)" />
    </chat-popup>
  `,
  styles: [`
    :host { display: block; flex: 1; min-height: 0; }
    .popup-mode__background {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 24px 16px 96px;
    }
    .popup-mode__background > app-mode-promo { flex: none; margin-block: auto; }
  `],
})
export class PopupMode {
  protected readonly agent = inject(AgUiShell).agent;
  protected readonly shell = inject(AgUiShell);
  // Phase 4: A2UI component catalog forwarded to <chat-popup>.
  protected readonly catalog = a2uiBasicCatalog();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
