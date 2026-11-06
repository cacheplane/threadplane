import { Component, signal } from '@angular/core';
import { TitleCasePipe } from '@angular/common';
import { ChatComponent } from '@threadplane/chat';
import { ExampleChatLayoutComponent } from '@threadplane/example-layouts';
import { injectAgent } from '@threadplane/langgraph';

// #region theme-presets
const THEMES: Record<string, Record<string, string>> = {
  dark: {
    '--tplane-chat-bg': '#1c1c1c',
    '--tplane-chat-surface': '#1c1c1c',
    '--tplane-chat-surface-alt': 'color-mix(in srgb, #e0e0e0 7%, #1c1c1c)',
    '--tplane-chat-primary': '#3b82f6',
    '--tplane-chat-on-primary': '#07111f',
    '--tplane-chat-text': '#e0e0e0',
    '--tplane-chat-separator': '#767676',
    '--tplane-chat-text-muted': '#a3a3a3',
  },
  light: {
    '--tplane-chat-bg': '#ffffff',
    '--tplane-chat-surface': '#ffffff',
    '--tplane-chat-surface-alt': 'color-mix(in srgb, #1a1a1a 7%, #ffffff)',
    '--tplane-chat-primary': '#2563eb',
    '--tplane-chat-on-primary': '#ffffff',
    '--tplane-chat-text': '#1a1a1a',
    '--tplane-chat-separator': '#858a94',
    '--tplane-chat-text-muted': '#6b7280',
  },
  ocean: {
    '--tplane-chat-bg': '#111b31',
    '--tplane-chat-surface': '#111b31',
    '--tplane-chat-surface-alt': 'color-mix(in srgb, #c8d6e5 7%, #111b31)',
    '--tplane-chat-primary': '#0abde3',
    '--tplane-chat-on-primary': '#07111f',
    '--tplane-chat-text': '#c8d6e5',
    '--tplane-chat-separator': '#607b9c',
    '--tplane-chat-text-muted': '#a3b8cf',
  },
  forest: {
    '--tplane-chat-bg': '#203420',
    '--tplane-chat-surface': '#203420',
    '--tplane-chat-surface-alt': 'color-mix(in srgb, #d4e6d4 7%, #203420)',
    '--tplane-chat-primary': '#4ade80',
    '--tplane-chat-on-primary': '#102410',
    '--tplane-chat-text': '#d4e6d4',
    '--tplane-chat-separator': '#769076',
    '--tplane-chat-text-muted': '#a7c0a7',
  },
};
// #endregion

/**
 * ThemingComponent demonstrates chat theming with CSS custom properties.
 * A sidebar with theme picker buttons swaps CSS variables at runtime,
 * showcasing the --tplane-chat-* token system and custom theme presets.
 */
@Component({
  selector: 'app-theming',
  standalone: true,
  imports: [ChatComponent, ExampleChatLayoutComponent, TitleCasePipe],
  template: `
    <!-- #region theme-picker -->
    <example-chat-layout sidebarWidth="18rem"
      title="Chat theming"
      description="Ask an aviation question and watch the answer arrive. Switch palettes at any time; your conversation and draft stay in place. Continue after the response is saved."
    >
      <button headerActions type="button" [disabled]="agent.isLoading()"
        (click)="newConversation(conversation)">New conversation</button>
      <chat placeholder="Ask an aviation question…" #conversation [welcomeDisabled]="true" main [agent]="agent" class="flex-1 min-w-0">
        <p chatFooterStatus role="status" class="example-submission-status">{{ agent.isLoading() ? 'Receiving response…' : agent.error() ? 'Response failed. Try again.' : 'Ready.' }}</p>
      </chat>
      <div sidebar class="panel">
        <h3 class="cap">Theme Picker</h3>
        <div class="theme-list">
          @for (name of themeNames; track name) {
            <button
              class="theme-button"
              [class.theme-button--active]="activeTheme() === name"
              (click)="setTheme(name)">
              {{ name | titlecase }}
            </button>
          }
        </div>
        <div>
          <h4 class="cap">CSS Variables</h4>
          <ul class="token-list">
            <li><code>--tplane-chat-bg</code></li>
            <li><code>--tplane-chat-surface</code></li>
            <li><code>--tplane-chat-surface-alt</code></li>
            <li><code>--tplane-chat-primary</code></li>
            <li><code>--tplane-chat-on-primary</code></li>
            <li><code>--tplane-chat-text</code></li>
            <li><code>--tplane-chat-separator</code></li>
            <li><code>--tplane-chat-text-muted</code></li>
          </ul>
        </div>
      </div>
    </example-chat-layout>
    <!-- #endregion -->
  `,
  styles: [`
    .panel {
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      padding: 1rem;
      background: var(--tplane-chat-bg);
      color: var(--tplane-chat-text);
    }

    .cap {
      margin: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 700;
      letter-spacing: 0.12em;
      line-height: var(--tplane-chat-line-height-tight);
      text-transform: uppercase;
    }

    .theme-list {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    .theme-button {
      width: 100%;
      padding: 0.5rem 0.75rem;
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-button);
      background: var(--tplane-chat-surface-alt);
      color: var(--tplane-chat-text);
      cursor: pointer;
      font: inherit;
      font-size: var(--tplane-chat-font-size-xs);
      font-weight: 600;
      line-height: var(--tplane-chat-line-height-tight);
      text-align: left;
      transition: background-color 120ms ease, border-color 120ms ease, color 120ms ease;
    }

    .theme-button:hover {
      border-color: var(--tplane-chat-primary);
    }

    .theme-button--active {
      border-color: var(--tplane-chat-primary);
      background: var(--tplane-chat-primary);
      color: var(--tplane-chat-on-primary);
    }

    .token-list {
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      margin: 0.5rem 0 0;
      padding: 0;
      color: var(--tplane-chat-text-muted);
      font-size: var(--tplane-chat-font-size-xs);
      line-height: var(--tplane-chat-line-height);
      list-style: none;
    }

    .token-list code {
      color: var(--tplane-chat-text-muted);
      font-family: var(--tplane-chat-font-mono);
    }
  `],
})
// #region apply-theme
export class ThemingComponent {
  protected newConversation(conversation: ChatComponent): void {
    if (this.agent.isLoading()) return;
    this.agent.switchThread(null);
    conversation.clearDraft();
  }

  protected readonly agent = injectAgent();

  protected readonly themeNames = Object.keys(THEMES);
  protected readonly activeTheme = signal('dark');

  constructor() {
    this.setTheme(this.activeTheme());
  }

  setTheme(name: string) {
    const theme = THEMES[name];
    if (!theme) return;
    this.activeTheme.set(name);
    document.documentElement.style.colorScheme = name === 'light' ? 'light' : 'dark';
    Object.entries(theme).forEach(([key, value]) => {
      document.documentElement.style.setProperty(key, value);
    });
  }
}
// #endregion
