import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatPopupComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent } from '@threadplane/chat';
import { DemoShell } from '../shell/demo-shell.component';
import { DEMO_AGENT } from '../shell/shell-tokens';
import { demoViews } from '../demo-views';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';
import { AppModePromoComponent } from './app-mode-promo.component';

@Component({
  selector: 'popup-mode',
  standalone: true,
  imports: [ChatPopupComponent, WelcomeSuggestionsComponent, AppModePromoComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent],
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
      <ng-template chatInterruptTemplate let-agent>
        <chat-interrupt-panel [agent]="agent" (action)="shell.onInterruptAction($event)" />
      </ng-template>
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'"
        [featuredId]="shell.featuredSuggestionId" (selected)="send($event)" />
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
  protected readonly agent = inject(DEMO_AGENT);
  protected readonly shell = inject(DemoShell);
  // A2UI catalog + registered tool views — see demo-views.ts.
  protected readonly catalog = demoViews();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
