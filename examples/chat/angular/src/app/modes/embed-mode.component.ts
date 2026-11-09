import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent } from '@threadplane/chat';
import { DemoShell } from '../shell/demo-shell.component';
import { DEMO_AGENT } from '../shell/shell-tokens';
import { demoViews } from '../demo-views';
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
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'"
        [featuredId]="shell.featuredSuggestionId" (selected)="send($event)" />
    </chat>
  `,
  styles: [`
    :host { display: block; flex: 1; min-height: 0; }
  `],
})
export class EmbedMode {
  protected readonly agent = inject(DEMO_AGENT);
  protected readonly shell = inject(DemoShell);
  // A2UI catalog + registered tool views — see demo-views.ts.
  protected readonly catalog = demoViews();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
