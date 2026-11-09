import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent, a2uiBasicCatalog } from '@threadplane/chat';
import { AgUiShell } from '../shell/ag-ui-shell.component';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';

@Component({
  selector: 'embed-mode',
  standalone: true,
  imports: [ChatComponent, WelcomeSuggestionsComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <chat
      [agent]="agent"
      [clientTools]="shell.clientTools"
      [views]="catalog"
      [modelOptions]="shell.modelOptions()"
      [selectedModel]="shell.model()"
      [showModelPicker]="shell.showInlineModelPicker()"
      (selectedModelChange)="shell.onModelChange($event)"
    >
      <ng-template chatInterruptTemplate let-agent>
        <chat-interrupt-panel [agent]="agent" (action)="shell.onInterruptAction($event)" />
      </ng-template>
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'" (selected)="send($event)" />
    </chat>
  `,
  styles: [`
    :host { display: block; flex: 1; min-height: 0; }
  `],
})
export class EmbedMode {
  protected readonly agent = inject(AgUiShell).agent;
  protected readonly shell = inject(AgUiShell);
  // Phase 4: catalog of A2UI components the chat composition uses to
  // render <a2ui-surface> when an AI message content begins with the
  // ---a2ui_JSON--- wire-format prefix. Without this, the surface is
  // parsed correctly but never mounted (the @if gate requires views()).
  protected readonly catalog = a2uiBasicCatalog();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
