import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatPopupComponent, a2uiBasicCatalog } from '@threadplane/angular/chat';
import { AgUiShell } from '../shell/ag-ui-shell.component';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';
import { AppModePromoComponent } from './app-mode-promo.component';

@Component({
  selector: 'popup-mode',
  standalone: true,
  imports: [ChatPopupComponent, WelcomeSuggestionsComponent, AppModePromoComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="popup-mode__background">
      <!-- The chat is a floating launcher here, so the area behind it markets
           App mode (same hero as sidebar mode). App mode forces sidebar, so in
           popup mode it is effectively always off — gate it the same way for
           symmetry with sidebar mode. -->
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
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'" (selected)="send($event)" />
    </chat-popup>
  `,
  styles: [`
    :host { display: block; flex: 1; min-height: 0; }
    .popup-mode__background {
      display: grid;
      place-items: center;
      height: 100%;
    }
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
