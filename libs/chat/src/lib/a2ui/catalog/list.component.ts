import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

/** Renders A2UI child elements in a horizontal or vertical list with configurable alignment. */
@Component({
  selector: 'a2ui-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.Default,
  imports: [RenderElementComponent],
  template: `
    <div [class]="listClass()" [style.align-items]="alignmentCss()">
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </div>
  `,
  styles: [`
    .a2ui-list--vertical {
      display: flex;
      flex-direction: column;
      gap: var(--a2ui-spacing-1);
      overflow-y: auto;
      max-height: 384px;
    }
    .a2ui-list--horizontal {
      display: flex;
      flex-direction: row;
      gap: var(--a2ui-spacing-1);
      overflow-x: auto;
    }
  `],
})
export class A2uiListComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  readonly direction = input<'vertical' | 'horizontal'>('vertical');
  /** v0.9 prop: cross-axis alignment (default 'stretch'). */
  readonly align = input<'start' | 'center' | 'end' | 'stretch'>('stretch');
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly emit = input<(event: string) => void>(() => { /* noop */ });
  readonly loading = input<boolean>(false);

  protected readonly listClass = computed(() => {
    return this.direction() === 'horizontal'
      ? 'a2ui-list--horizontal'
      : 'a2ui-list--vertical';
  });

  protected readonly alignmentCss = computed<string>(() => {
    const a = this.align();
    return a === 'start' ? 'flex-start'
         : a === 'end' ? 'flex-end'
         : a; // center / stretch are valid CSS values as-is
  });
}
