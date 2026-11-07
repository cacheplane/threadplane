import { Component, computed, input } from '@angular/core';

@Component({
  selector: 'app-data-grid',
  standalone: true,
  template: `
    <div class="data-grid">
      <div class="data-grid__title">{{ title() }}</div>
      @if (isSkeleton()) {
        @for (i of skeletonRows; track i) {
          <div class="skeleton skeleton-row"></div>
        }
      } @else if (rows()?.length === 0) {
        <p class="dashboard-empty">No disruptions.</p>
      } @else {
        <div class="data-grid__scroll" role="region" tabindex="0" [attr.aria-label]="title() + ' table'">
          <table class="data-grid__table" [attr.aria-label]="title()">
            <thead>
              <tr>
                @for (col of formattedColumns(); track col.key) {
                  <th scope="col">{{ col.label }}</th>
                }
              </tr>
            </thead>
            <tbody>
              @for (row of rows(); track $index) {
                <tr>
                  @for (col of formattedColumns(); track col.key) {
                    <td>{{ row[col.key] }}</td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styleUrls: ['./skeleton.css'],
  styles: [`
    .data-grid {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-card);
      background: var(--tplane-chat-surface-alt);
      backdrop-filter: blur(4px);
    }
    .data-grid__title {
      font-size: 13px;
      font-weight: 600;
      color: var(--tplane-chat-text-muted);
      letter-spacing: 0.01em;
    }
    .data-grid__scroll {
      overflow-x: auto;
      margin: 0 -4px;
    }
    .data-grid__table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      font-variant-numeric: tabular-nums;
    }
    .data-grid__table th {
      text-align: left;
      padding: 8px 10px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: var(--tplane-chat-text-muted);
      border-bottom: 1px solid var(--tplane-chat-separator);
      white-space: nowrap;
    }
    .data-grid__table td {
      padding: 10px;
      color: var(--tplane-chat-text);
      border-bottom: 1px solid var(--tplane-chat-separator);
      white-space: nowrap;
    }
    .data-grid__table tbody tr:nth-child(even) td {
      background: var(--tplane-chat-surface);
    }
    .data-grid__table tbody tr:last-child td {
      border-bottom: none;
    }
  `],
})
export class DataGridComponent {
  readonly title = input<string>('');
  readonly rows = input<Record<string, unknown>[] | null>(null);
  readonly columns = input<string[]>([]);

  readonly skeletonRows = [0, 1, 2, 3];

  readonly isSkeleton = computed(() => this.rows() == null);

  readonly formattedColumns = computed(() =>
    this.columns().map(key => ({
      key,
      label: key
        .split('_')
        .map(word =>
          word.length <= 3
            ? word.toUpperCase()
            : word.charAt(0).toUpperCase() + word.slice(1)
        )
        .join(' '),
    }))
  );
}
