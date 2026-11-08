// libs/example-layouts/src/lib/example-split-layout.component.ts
import { Component, ChangeDetectionStrategy, input } from '@angular/core';
import { installExampleViewport } from './example-viewport';

@Component({
  selector: 'example-split-layout',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    :host {
      position: fixed;
      top: var(--example-viewport-top, 0px);
      left: 0;
      width: 100%;
      display: flex;
      flex-direction: column;
      height: 100vh;
      height: var(--example-viewport-height, 100dvh);
      background: var(--tplane-chat-bg, #fff);
      color: var(--tplane-chat-text, #1a1a1a);
      font-family: var(--tplane-chat-font-family, system-ui, sans-serif);
    }
    .split__header {
      flex-shrink: 0;
      border-bottom: 1px solid var(--tplane-chat-separator, #e5e5e5);
    }
    .split__header:empty { display: none; }
    .split__main { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
    .split__title {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: none;
      flex-wrap: wrap;
      gap: 8px 16px;
      min-height: 53px;
      box-sizing: border-box;
      padding: 8px 16px;
      border-bottom: 1px solid var(--tplane-chat-separator, #e5e5e5);
      background: var(--tplane-chat-surface, #fff);
    }
    .split__title h1 { flex: 1 1 0%; min-width: 0; margin: 0; font-size: 14px; line-height: 21px; font-weight: 700; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .split__about { flex: none; padding: 16px; color: var(--tplane-chat-text-muted, #737373); font-size: 12px; line-height: 1.6; }
    .split__about h2 { margin: 0 0 12px; font-size: 12px; line-height: 18px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; }
    .split__about p { margin: 0; }
    .split__body {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .split__primary {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      min-height: 0;
    }
    .split__secondary {
      width: 100%;
      flex-shrink: 0;
      display: flex;
      flex-direction: column;
      border-top: 1px solid var(--tplane-chat-separator, #e5e5e5);
      background: var(--tplane-chat-bg, #fff);
      min-height: 0;
      max-height: calc(var(--example-viewport-height, 100dvh) * 0.2);
      height: calc(var(--example-viewport-height, 100dvh) * 0.2);
      overflow-y: auto;
    }
    .split__secondary:empty { display: none; }
    .split__footer { flex-shrink: 0; }
    .split__footer:empty { display: none; }
    @media (min-width: 768px) {
      .split__body { flex-direction: row; }
      .split__primary { padding: 1.5rem; min-height: 0; }
      .split__secondary {
        width: 18rem;
        max-height: none;
        height: auto;
        border-top: 0;
        border-left: 1px solid var(--tplane-chat-separator, #e5e5e5);
      }
    }
  `,
  template: `
    <div class="split__body">
      <div class="split__main">
        @if (title()) {
          <header class="split__title">
            <h1>{{ title() }}</h1>
            <ng-content select="[headerActions]" />
          </header>
        }
        <div class="split__header"><ng-content select="[header]" /></div>
        <div class="split__primary"><ng-content select="[primary]" /></div>
        <div class="split__footer"><ng-content select="[footer]" /></div>
      </div>
      <div class="split__secondary">
        @if (description()) {
          <section class="split__about" aria-label="About this example">
            <h2>About this example</h2>
            <p>{{ description() }}</p>
          </section>
        }
        <ng-content select="[secondary]" />
      </div>
    </div>
  `,
})
export class ExampleSplitLayoutComponent {
  constructor() { installExampleViewport(); }
  readonly title = input('');
  readonly description = input('');
}
