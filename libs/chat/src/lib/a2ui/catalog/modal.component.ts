import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

/** Renders an A2UI trigger that opens its associated child content in a modal overlay. */
@Component({
  selector: 'a2ui-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [RenderElementComponent],
  template: `
    <!-- Entry point (trigger): always rendered inline, e.g. a button. -->
    @if (entryPointKey(); as epKey) {
      <div
        class="a2ui-modal__trigger"
        role="button"
        tabindex="0"
        aria-label="Open modal"
        (click)="open.set(true)"
        (keydown.enter)="open.set(true)"
        (keydown.space)="open.set(true)"
      >
        <render-element [elementKey]="epKey" [spec]="spec()" />
      </div>
    }

    <!-- Modal overlay: shown when open. -->
    @if (open()) {
      <div
        class="a2ui-modal__overlay"
        role="dialog"
        aria-modal="true"
      >
        <div
          class="a2ui-modal__backdrop"
          role="button"
          tabindex="0"
          aria-label="Dismiss dialog"
          (click)="open.set(false)"
          (keydown.enter)="open.set(false)"
          (keydown.space)="open.set(false)"
        ></div>
        <div class="a2ui-modal__panel">
          @if (contentKey(); as cKey) {
            <render-element [elementKey]="cKey" [spec]="spec()" />
          }
        </div>
      </div>
    }
  `,
  styles: [`
    .a2ui-modal__trigger {
      display: contents;
    }
    .a2ui-modal__overlay {
      position: fixed;
      inset: 0;
      z-index: 50;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .a2ui-modal__backdrop {
      position: absolute;
      inset: 0;
      background: var(--a2ui-scrim);
      backdrop-filter: blur(4px);
    }
    .a2ui-modal__panel {
      position: relative;
      background: var(--a2ui-surface);
      border: 1px solid var(--a2ui-outline);
      border-radius: var(--a2ui-shape-medium);
      padding: var(--a2ui-spacing-5);
      max-width: 512px;
      width: 100%;
      margin: 0 var(--a2ui-spacing-4);
      box-shadow: var(--a2ui-elevation-4);
    }
  `],
})
export class A2uiModalComponent {
  /**
   * v0.9: childKeys[0] = trigger (inline entry point),
   *       childKeys[1] = content (modal body).
   */
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);

  protected readonly open = signal(false);

  protected readonly entryPointKey = computed(() => this.childKeys()[0] ?? null);
  protected readonly contentKey = computed(() => this.childKeys()[1] ?? null);
}
