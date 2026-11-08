import { Component, computed, input, OnDestroy, viewChild, ElementRef, effect, signal } from '@angular/core';
import {
  RenderSpecComponent,
  RenderElementComponent,
  defineAngularRegistry,
  signalStateStore,
} from '@threadplane/render';
import type { Spec } from '@json-render/core';
import { StreamingSimulator } from '../../../../shared/streaming-simulator';
import { StreamingTimelineComponent } from '../../../../shared/streaming-timeline.component';
import { ExampleSplitLayoutComponent } from '@threadplane/example-layouts';
import { ELEMENT_RENDERING_SPECS } from './specs';
import { highlightJson } from '../../../../shared/json-highlight';
import { toDisplayText } from '../../../../shared/to-display-text';

// --- Inline view components registered in the demo registry ---

@Component({
  selector: 'demo-text',
  standalone: true,
  styles: `.t { margin: 0; font-size: 13px; line-height: 1.55; color: var(--ds-text-secondary, #c8c8c8); }`,
  template: `
    @if (displayContent()) {
      <p class="t">{{ displayContent() }}</p>
    } @else if (loading()) {
      <div class="sr-skeleton" style="height: 11px; width: 100%; margin: 3px 0;"></div>
      <div class="sr-skeleton" style="height: 11px; width: 66%; margin: 3px 0;"></div>
    }
  `,
})
class DemoTextComponent {
  readonly content = input<unknown>('');
  readonly displayContent = computed(() => toDisplayText(this.content()));
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | null>(null);
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => {});
  readonly loading = input(false);
}

// #region child-recursion
@Component({
  selector: 'demo-heading',
  standalone: true,
  imports: [RenderElementComponent],
  styles: `.h { margin: 0 0 0.5rem; font-size: 1.05rem; font-weight: 700; color: var(--ds-text-primary, #f5f5f5); }`,
  template: `
    @if (displayContent()) {
      <h2 class="h">{{ displayContent() }}</h2>
    } @else if (loading()) {
      <div class="sr-skeleton" style="height: 18px; width: 12rem; margin-bottom: 0.5rem;"></div>
    }
    @for (key of childKeys(); track key) {
      <render-element [elementKey]="key" [spec]="spec()!" />
    }
  `,
})
class DemoHeadingComponent {
  readonly content = input<unknown>('');
  readonly displayContent = computed(() => toDisplayText(this.content()));
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | null>(null);
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => {});
  readonly loading = input(false);
}
// #endregion

@Component({
  selector: 'demo-card',
  standalone: true,
  imports: [RenderElementComponent],
  styles: `
    .card {
      margin-bottom: 0.75rem;
      padding: 16px;
      background: var(--ds-surface, #1c1c1c);
      border: 1px solid var(--ds-border, #2d2d2d);
      border-radius: var(--ds-radius-lg, 14px);
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3) /* dark-tuned; the --ds-shadow tokens are light-tuned and vanish on dark surfaces */;
    }
    .card__title {
      margin: 0 0 0.625rem;
      font-size: 13px;
      font-weight: 600;
      color: var(--ds-text-primary, #f5f5f5);
    }
  `,
  template: `
    <div class="card">
      @if (title()) {
        <div class="card__title">{{ title() }}</div>
      } @else if (loading()) {
        <div class="sr-skeleton" style="height: 14px; width: 8rem; margin-bottom: 0.625rem;"></div>
      }
      @if (childKeys().length) {
        @for (key of childKeys(); track key) {
          <render-element [elementKey]="key" [spec]="spec()!" />
        }
      } @else if (loading()) {
        <div class="sr-skeleton" style="height: 11px; width: 100%; margin: 4px 0;"></div>
        <div class="sr-skeleton" style="height: 11px; width: 75%; margin: 4px 0;"></div>
      }
    </div>
  `,
})
class DemoCardComponent {
  readonly title = input('');
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | null>(null);
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => {});
  readonly loading = input(false);
}

@Component({
  selector: 'app-element-rendering',
  standalone: true,
  imports: [RenderSpecComponent, StreamingTimelineComponent, ExampleSplitLayoutComponent],
  styles: `
    .bar { display: flex; align-items: center; gap: 0.875rem; padding: 0.75rem 1rem; }
    .bar__lbl {
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .tabs {
      display: flex;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: var(--ds-surface-dim, #0a0a0a);
      border: 1px solid var(--ds-border, #2d2d2d);
    }
    .tab {
      padding: 6px 14px;
      font-size: 12px;
      border: 0;
      border-radius: 999px;
      background: transparent;
      color: var(--ds-text-muted, #a0a0a0);
      cursor: pointer;
      transition: color 0.15s ease, background 0.15s ease;
    }
    .tab:hover { color: var(--ds-text-secondary, #c8c8c8); }
    .tab--on {
      background: var(--ds-render-green, #1a7a40);
      color: #eafff2;
      font-weight: 600;
      box-shadow: 0 1px 8px rgba(26, 122, 64, 0.5);
    }
    .status {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 7px;
      font-size: 11px;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .status__dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #35b06a;
      box-shadow: 0 0 0 4px rgba(53, 176, 106, 0.13);
    }
    .status__dot--live { animation: sr-pulse 1.6s ease-in-out infinite; }
    @keyframes sr-pulse { 50% { opacity: 0.4; } }
    .cap {
      margin-bottom: 1rem;
      font-size: 10px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .placeholder { font-size: 13px; font-style: italic; color: var(--ds-text-muted, #a0a0a0); }
    /* The JSON viewer is a code console: pin it to a dark surface with a
       fixed palette in BOTH themes so the syntax colors stay legible. */
    .json-pane {
      --code-fg: rgb(200, 200, 200);
      --code-muted: rgb(150, 150, 150);
      --code-border: rgba(255, 255, 255, 0.09);
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      padding: 1rem;
      background: #0b0b0b;
    }
    .json-pane .cap { color: var(--code-muted); }
    .json {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      margin: 0;
      font-family: var(--ds-font-mono, ui-monospace, monospace);
      font-size: 11.5px;
      line-height: 1.7;
      white-space: pre-wrap;
      word-break: break-all;
      color: var(--code-fg);
    }
    .json .j-key { color: #7fe0a3; }
    .json .j-string { color: #c9c17f; }
    .json .j-number { color: #e6b673; }
    .json .j-literal { color: #7fd6ff; }
    .json .j-punct { color: var(--code-muted); }
    .json__cursor {
      display: inline-block;
      width: 7px;
      height: 14px;
      vertical-align: -2px;
      background: #35b06a;
      animation: sr-blink 1s step-end infinite;
    }
    @keyframes sr-blink { 50% { opacity: 0; } }
    .json__foot {
      display: flex;
      justify-content: space-between;
      margin-top: 0.75rem;
      padding-top: 0.625rem;
      font-size: 10.5px;
      border-top: 1px solid var(--code-border);
    }
    .json__foot .state { color: #35b06a; font-weight: 600; }
    .json__foot .state--idle { color: var(--code-muted); font-weight: 400; }
    .json__foot .pct { color: var(--code-muted); font-variant-numeric: tabular-nums; }
    .controls {
      flex-shrink: 0;
      padding: 1rem;
      border-top: 1px solid var(--ds-border, #2d2d2d);
      background: var(--ds-surface, #1c1c1c);
    }
    .controls .cap { margin-bottom: 0.75rem; }
    .control-row { display: flex; align-items: center; gap: 0.6rem; margin-bottom: 0.6rem; }
    .control-row:last-child { margin-bottom: 0; }
    .control-label {
      font-size: 12px;
      color: var(--ds-text-secondary, #c8c8c8);
      min-width: 3rem;
    }
    .control-check {
      width: 15px; height: 15px;
      accent-color: var(--ds-render-green, #1a7a40);
      cursor: pointer;
    }
    .control-input,
    .control-select {
      flex: 1;
      min-width: 0;
      padding: 5px 8px;
      font-size: 12px;
      color: var(--ds-text-primary, #f5f5f5);
      background: var(--ds-surface-dim, #0a0a0a);
      border: 1px solid var(--ds-border, #2d2d2d);
      border-radius: var(--ds-radius-sm, 6px);
    }
    .control-input:focus,
    .control-select:focus {
      outline: none;
      border-color: #35b06a;
      box-shadow: 0 0 0 3px rgba(53, 176, 106, 0.25);
    }
    .control-btn {
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 600;
      color: #eafff2;
      background: var(--ds-render-green, #1a7a40);
      border: 0;
      border-radius: var(--ds-radius-sm, 6px);
      cursor: pointer;
      transition: box-shadow 0.15s ease, transform 0.1s ease;
    }
    .control-btn:hover { box-shadow: 0 2px 10px rgba(26, 122, 64, 0.5); }
    .control-btn:active { transform: scale(0.97); }
    .control-hint {
      margin-top: 0.5rem;
      font-size: 10.5px;
      line-height: 1.5;
      color: var(--ds-text-muted, #a0a0a0);
    }
    .list-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.5rem;
      margin-bottom: 4px;
      padding: 5px 10px;
      font-size: 12px;
      color: var(--ds-text-secondary, #c8c8c8);
      background: var(--ds-surface-dim, #0a0a0a);
      border: 1px solid var(--ds-border, #2d2d2d);
      border-radius: var(--ds-radius-sm, 6px);
    }
    .list-row__remove {
      padding: 0 4px;
      font-size: 13px;
      line-height: 1;
      color: var(--ds-text-muted, #a0a0a0);
      background: none;
      border: 0;
      cursor: pointer;
      transition: color 0.12s ease;
    }
    .list-row__remove:hover { color: #ef4444; }
  `,
  template: `
    <example-split-layout
      title="Element Rendering"
      description="Render ordered children and nested views. Choose whether the native renderer shows the conditional detail."
    >
      <!-- Spec picker + streaming status -->
      <div header class="bar">
        <span class="bar__lbl">Spec</span>
        <div class="tabs">
          @for (spec of specs; track spec.label; let i = $index) {
            <button type="button" class="tab" [class.tab--on]="i === activeIndex" (click)="selectSpec(i)">
              {{ spec.label }}
            </button>
          }
        </div>
        <span class="status">
          <span class="status__dot" [class.status__dot--live]="simulator.playing()"></span>
          {{ statusLabel() }}
        </span>
      </div>

      <!-- Left: live render output -->
      <!-- #region render-spec-host -->
      <div primary>
        <div class="cap">Live Render Output</div>
        @if (simulator.spec(); as renderedSpec) {
          <render-spec [spec]="renderedSpec" [registry]="registry" [store]="store" [loading]="simulator.playing()" />
        } @else {
          <div class="placeholder">Press play to start streaming…</div>
        }
      </div>
      <!-- #endregion -->

      <!-- Right: JSON + Controls -->
      <div secondary style="display:flex; flex-direction:column; height:100%">
        <div class="json-pane">
          <div class="cap">Streaming JSON</div>
          <pre class="json" #jsonScroll>@for (tok of jsonTokens(); track $index) {<span [class]="'j-' + tok.kind">{{ tok.text }}</span>}<span class="json__cursor"></span></pre>
          <div class="json__foot">
            <span class="state" [class.state--idle]="!simulator.playing()">{{ streamStateLabel() }}</span>
            <span class="pct">{{ percent() }}%</span>
          </div>
        </div>

        <div class="controls">
          <div class="cap">Controls</div>
          <label class="control-row">
            <input type="checkbox" class="control-check" [checked]="showDetail()" (change)="onToggleDetail($event)" />
            <span class="control-label" style="min-width:auto">Show Detail</span>
          </label>
          <p class="control-hint">Toggles <code>/showDetail</code> in the state store. Elements with <code>visible</code> bindings react instantly.</p>
        </div>
      </div>

      <!-- Transport -->
      <streaming-timeline footer [simulator]="simulator" />
    </example-split-layout>
  `,
})
export class ElementRenderingComponent implements OnDestroy {
  protected readonly specs = ELEMENT_RENDERING_SPECS;
  protected activeIndex = 0;

  protected readonly simulator = new StreamingSimulator(this.specs[0].json);

  protected readonly jsonTokens = computed(() => highlightJson(this.simulator.rawJson()));

  private readonly jsonScroll = viewChild<ElementRef<HTMLElement>>('jsonScroll');

  // #region registry-and-store
  protected readonly registry = defineAngularRegistry({
    Text: DemoTextComponent,
    Heading: DemoHeadingComponent,
    Card: DemoCardComponent,
  });

  protected readonly store = signalStateStore({ showDetail: true });

  /** Angular signal tracking store value for template reactivity. */
  protected readonly showDetail = signal(true);

  constructor() {
    // Sync store changes to Angular signal for change detection
    this.store.subscribe(() => {
      this.showDetail.set(this.store.get('/showDetail') as boolean ?? true);
    });
    // #endregion

    // Auto-scroll JSON pane
    effect(() => {
      this.simulator.rawJson();
      const el = this.jsonScroll()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }

  // #region visibility-toggle
  protected onToggleDetail(_event: Event): void {
    const current = this.showDetail();
    this.store.set('/showDetail', !current);
    this.showDetail.set(!current);
  }
  // #endregion

  protected percent(): number {
    return Math.round(this.simulator.progress() * 100);
  }

  protected statusLabel(): string {
    if (this.simulator.playing()) return 'Streaming';
    return this.simulator.position() >= this.simulator.total() ? 'Complete' : 'Paused';
  }

  protected streamStateLabel(): string {
    if (this.simulator.playing()) return 'Streaming…';
    return this.simulator.position() >= this.simulator.total() ? 'Complete' : 'Paused';
  }

  protected selectSpec(index: number): void {
    this.activeIndex = index;
    this.simulator.setSource(this.specs[index].json);
    this.simulator.play();
  }

  ngOnDestroy(): void {
    this.simulator.destroy();
  }
}
