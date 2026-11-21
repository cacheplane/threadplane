import { Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import { RenderElementComponent } from '@threadplane/angular/render';

@Component({
  selector: 'app-dashboard-grid',
  standalone: true,
  imports: [RenderElementComponent],
  template: `
    <div class="dashboard-grid">
      @for (key of childKeys(); track key) {
        <render-element [elementKey]="key" [spec]="spec()" />
      }
    </div>
  `,
  styles: [`
    .dashboard-grid {
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 4px 0;
      width: 100%;
      min-width: 0;
    }
  `],
})
export class DashboardGridComponent {
  readonly childKeys = input<string[]>([]);
  readonly spec = input.required<Spec>();
}
