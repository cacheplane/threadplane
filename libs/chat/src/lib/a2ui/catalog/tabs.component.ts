import { ChangeDetectionStrategy, Component, computed, effect, input, signal } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

/** Renders A2UI tab titles and the child content for the locally selected tab. */
@Component({
  selector: 'a2ui-tabs',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [RenderElementComponent],
  template: `
    <div class="a2ui-tabs">
      <div class="a2ui-tabs__tablist" role="tablist">
        @for (title of tabTitles(); track $index) {
          <button
            role="tab"
            [class]="$index === activeIndex() ? 'a2ui-tabs__tab a2ui-tabs__tab--active' : 'a2ui-tabs__tab'"
            [attr.aria-selected]="$index === activeIndex()"
            (click)="selectTab($index)"
          >{{ title }}</button>
        }
      </div>
      <div class="a2ui-tabs__panel" role="tabpanel">
        @if (activeChildKey(); as key) {
          <render-element [elementKey]="key" [spec]="spec()" />
        }
      </div>
    </div>
  `,
  styles: [`
    .a2ui-tabs { display: flex; flex-direction: column; }
    .a2ui-tabs__tablist {
      display: flex;
      border-bottom: 1px solid var(--a2ui-outline);
    }
    .a2ui-tabs__tab {
      padding: var(--a2ui-spacing-2) var(--a2ui-spacing-4);
      font-size: var(--a2ui-typography-body-size);
      font-weight: 500;
      cursor: pointer;
      background: transparent;
      border: none;
      border-bottom: 2px solid transparent;
      color: var(--a2ui-label);
      transition: color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard),
                  border-color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
      margin-bottom: -1px;
    }
    .a2ui-tabs__tab:hover { color: var(--a2ui-on-surface); }
    .a2ui-tabs__tab--active {
      border-bottom-color: var(--a2ui-primary);
      color: var(--a2ui-on-surface);
    }
    .a2ui-tabs__panel { padding-top: var(--a2ui-spacing-3); }
  `],
})
export class A2uiTabsComponent {
  /** Resolved tab titles from tabs[*].title — produced by surface-to-spec. */
  readonly tabTitles = input<string[]>([]);
  /** v0.9: each child key corresponds to a tab's child (childKeys[i] ↔ tabTitles[i]). */
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);

  protected readonly activeIndex = signal(0);

  constructor() {
    // Reset active tab when the surface changes entirely.
    effect(() => {
      const len = this.childKeys().length;
      if (this.activeIndex() >= len && len > 0) this.activeIndex.set(0);
    });
  }

  protected readonly activeChildKey = computed(() => {
    const idx = this.activeIndex();
    const keys = this.childKeys();
    return idx >= 0 && idx < keys.length ? keys[idx] : null;
  });

  selectTab(index: number): void {
    this.activeIndex.set(index);
  }
}
