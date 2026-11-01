import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

/** Renders A2UI child elements inside a padded card. */
@Component({
  selector: 'a2ui-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [RenderElementComponent],
  template: `
    <div class="a2ui-card">
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </div>
  `,
  styles: [`
    .a2ui-card {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-2);
      border-radius: var(--a2ui-shape-medium);
      border: 1px solid var(--a2ui-outline);
      background: var(--a2ui-surface);
      padding: var(--a2ui-spacing-4);
      box-shadow: var(--a2ui-elevation-1);
    }
  `],
})
export class A2uiCardComponent {
  /** v1: a single child key, delivered via childKeys[0] from the render framework. */
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);
}
