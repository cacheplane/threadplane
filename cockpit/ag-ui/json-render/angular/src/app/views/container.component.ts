import { Component, computed, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/render';

@Component({
  selector: 'app-container',
  standalone: true,
  imports: [RenderElementComponent],
  template: `
    <div class="container" [attr.data-direction]="direction()" [attr.data-chart-row]="hasChart() ? '' : null" [style.--container-cols]="rowChildCount()">
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </div>
  `,
  styles: [`
    .container {
      display: grid;
      gap: 12px;
      min-width: 0;
    }
    .container[data-direction="column"] {
      grid-template-columns: 1fr;
    }
    .container[data-direction="row"] {
      grid-template-columns: repeat(var(--container-cols, 1), minmax(0, 1fr));
    }
    .container[data-direction="row"][data-chart-row] {
      grid-template-columns: repeat(auto-fit, minmax(min(100%, 320px), 1fr));
      align-items: start;
    }
    /* Responsive collapse: at narrow widths, row containers stack to single column */
    @media (max-width: 720px) {
      .container[data-direction="row"] {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    @media (max-width: 480px) {
      .container[data-direction="row"] {
        grid-template-columns: 1fr;
      }
    }
  `],
})
export class ContainerComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
  readonly direction = input<'row' | 'column'>('column');

  readonly rowChildCount = computed(() => Math.max(1, this.childKeys().length));
  readonly hasChart = computed(() => this.childKeys().some(key =>
    ['line_chart', 'bar_chart'].includes(this.spec().elements[key]?.type)));
}
