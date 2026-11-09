import { Component, ChangeDetectionStrategy, inject } from '@angular/core';
import { ChatSidebarComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent, a2uiBasicCatalog } from '@threadplane/chat';
import { AgUiShell } from '../shell/ag-ui-shell.component';
import { MapCanvasComponent } from '../map-canvas.component';
import { AppModePromoComponent } from './app-mode-promo.component';
import { WelcomeSuggestionsComponent } from './welcome-suggestions.component';

@Component({
  selector: 'sidebar-mode',
  standalone: true,
  imports: [ChatSidebarComponent, MapCanvasComponent, AppModePromoComponent, WelcomeSuggestionsComponent, ChatInterruptTemplateDirective, ChatInterruptPanelComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <chat-sidebar
      [agent]="agent"
      [clientTools]="shell.clientTools"
      [views]="catalog"
      [modelOptions]="shell.modelOptions()"
      [selectedModel]="shell.model()"
      [showModelPicker]="false"
      [open]="true"
      [pushContent]="true"
      (selectedModelChange)="shell.onModelChange($event)"
    >
      <ng-template chatInterruptTemplate let-agent>
        <chat-interrupt-panel [agent]="agent" (action)="shell.onInterruptAction($event)" />
      </ng-template>
      <!-- In App mode the map IS the main content — projected into the sidebar's
           flex content slot so it fills the area left of the drawer (no absolute
           positioning / occupy-var inset in the shell). Plain sidebar mode
           markets the cockpit instead (#737), with a CTA to turn it on. -->
      @if (shell.appMode() === 'on') {
        <app-map-canvas class="sidebar-mode__map" />
      } @else {
        <div class="sidebar-mode__background">
          <app-mode-promo
            [hasMapsKey]="shell.hasMapsKey"
            (enable)="shell.onAppModeChange('on')"
          />
        </div>
      }
      <welcome-suggestions chatWelcomeSuggestions [appModeOn]="shell.appMode() === 'on'" (selected)="send($event)" />
    </chat-sidebar>
  `,
  styles: [`
    :host { display: block; flex: 1; min-height: 0; position: relative; }
    /* The map fills the chat-sidebar content slot (which is flex:1 at threaded
     * height); [pushContent] applies the right-margin push for the open drawer. */
    .sidebar-mode__map { display: block; height: 100%; }
    .sidebar-mode__background {
      display: flex;
      flex-direction: column;
      height: 100%;
      box-sizing: border-box;
      overflow-y: auto;
      overscroll-behavior: contain;
      padding: 24px 16px 96px;
    }
    .sidebar-mode__background > app-mode-promo { flex: none; margin-block: auto; }
  `],
})
export class SidebarMode {
  protected readonly agent = inject(AgUiShell).agent;
  protected readonly shell = inject(AgUiShell);
  // Phase 4: A2UI component catalog forwarded to <chat-sidebar>.
  protected readonly catalog = a2uiBasicCatalog();

  protected send(text: string): void {
    void this.agent.submit({ message: text });
  }
}
