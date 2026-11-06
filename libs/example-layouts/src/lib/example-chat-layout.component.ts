// libs/example-layouts/src/lib/example-chat-layout.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';

@Component({
  selector: 'example-chat-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: 100dvh;
      background: var(--tplane-chat-bg, #fff);
      color: var(--tplane-chat-text, #1a1a1a);
      font-family: var(--tplane-chat-font-family, system-ui, sans-serif);
      min-width: 0;
      min-height: 0;
    }
    .layout {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .layout__main { flex: 1; min-width: 0; min-height: 0; display: flex; flex-direction: column; }
    .layout__header {
      display: flex;
      flex: none;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px 16px;
      min-height: 53px;
      box-sizing: border-box;
      padding: 8px 16px;
      border-bottom: 1px solid var(--tplane-chat-separator, #e5e5e5);
      background: var(--tplane-chat-surface, #fff);
    }
    .layout__header h1 { flex: 1 1 0%; min-width: 0; margin: 0; font-size: 14px; line-height: 21px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .layout__actions { display: flex; align-items: center; flex: none; flex-wrap: wrap; max-width: 100%; gap: 8px; }
    .layout__actions:empty { display: none; }
    .layout__about { padding: 16px; color: var(--tplane-chat-text-muted, #737373); font-size: 12px; line-height: 1.6; }
    .layout__about h2 { margin: 0 0 12px; font-size: 12px; line-height: 18px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
    .layout__about p { margin: 0; }
    .layout__framework { margin: 0 16px 16px; color: var(--tplane-chat-text-muted, #737373); font-size: 12px; line-height: 19.2px; }
    .layout__sidebar {
      width: 100%;
      flex-shrink: 0;
      border-top: 1px solid var(--tplane-chat-separator, #e5e5e5);
      overflow-y: auto;
      min-height: 0;
      max-height: 20dvh;
      height: 20dvh;
    }
    .layout__sidebar:empty { display: none; }
    @media (min-width: 768px) {
      .layout { flex-direction: row; }
      .layout--sidebar-left { flex-direction: row-reverse; }
      .layout__sidebar {
        max-height: none;
        height: auto;
        width: var(--example-layout-sidebar-width, 18rem);
        border-top: 0;
        border-left: 1px solid var(--tplane-chat-separator, #e5e5e5);
      }
      .layout--sidebar-left .layout__sidebar {
        border-left: 0;
        border-right: 1px solid var(--tplane-chat-separator, #e5e5e5);
      }
    }
  `,
  template: `
    <div [class]="'layout layout--sidebar-' + sidebarPosition()" [style.--example-layout-sidebar-width]="sidebarWidth()">
      <div class="layout__main">
        @if (title()) {
          <header class="layout__header">
            <h1>{{ title() }}</h1>
            <div class="layout__actions"><ng-content select="[headerActions]" /></div>
          </header>
        }
        <ng-content select="[main]" />
      </div>
      <aside class="layout__sidebar">
        @if (description()) {
          <section class="layout__about" aria-label="About this example">
            <h2>About this example</h2>
            <p>{{ description() }}</p>
          </section>
        }
        <ng-content select="[sidebar]" />
        @if (description()) { <p class="layout__framework">Angular</p> }
      </aside>
    </div>
  `,
})
export class ExampleChatLayoutComponent {
  readonly title = input('');
  readonly description = input('');
  readonly sidebarPosition = input<'left' | 'right'>('right');
  readonly sidebarWidth = input('18rem');
}
