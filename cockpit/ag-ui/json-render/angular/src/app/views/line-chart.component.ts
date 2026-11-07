import { Component, computed, input } from '@angular/core';

let nextLineChartId = 0;

@Component({
  selector: 'app-line-chart',
  standalone: true,
  template: `
    <div class="chart-card">
      <div class="chart-card__title">{{ title() }}</div>
      @if (isSkeleton()) {
        <div class="skeleton skeleton-chart"></div>
      } @else if (data()?.length === 0) {
        <p class="dashboard-empty">No chart data.</p>
      } @else {
        <svg
          [attr.viewBox]="'0 0 ' + width + ' ' + height"
          class="chart-card__svg"
          preserveAspectRatio="xMidYMid meet"
          role="img"
          [attr.aria-label]="title()"
        >
          <!-- Gridlines -->
          @for (y of yGridLines(); track y.value) {
            <line
              [attr.x1]="padding.left"
              [attr.y1]="y.y"
              [attr.x2]="width - padding.right"
              [attr.y2]="y.y"
              stroke="var(--tplane-chat-separator)"
              stroke-width="1"
            />
            <text
              [attr.x]="padding.left - 8"
              [attr.y]="y.y + 4"
              text-anchor="end"
              fill="var(--tplane-chat-text-muted)"
              font-size="16"
            >{{ y.label }}</text>
          }
          <!-- Area fill under the line -->
          <path
            [attr.d]="areaPath()"
            [attr.fill]="'url(#' + gradientId + ')'"
            stroke="none"
          />
          <!-- Line -->
          <polyline
            [attr.points]="polylinePoints()"
            fill="none"
            stroke="var(--tplane-chat-primary)"
            stroke-width="2"
            stroke-linejoin="round"
            stroke-linecap="round"
          />
          <!-- Data points -->
          @for (pt of points(); track $index) {
            <circle [attr.cx]="pt.x" [attr.cy]="pt.y" r="3" fill="var(--tplane-chat-surface)" stroke="var(--tplane-chat-primary)" stroke-width="2" />
          }
          <!-- X-axis labels -->
          @for (pt of xLabels(); track $index) {
            <text
              [attr.x]="pt.x"
              [attr.y]="height - 6"
              text-anchor="middle"
              fill="var(--tplane-chat-text-muted)"
              font-size="16"
            >{{ pt.label }}</text>
          }
          <defs>
            <linearGradient [attr.id]="gradientId" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--tplane-chat-primary)" stop-opacity="0.28"/>
              <stop offset="100%" stop-color="var(--tplane-chat-primary)" stop-opacity="0"/>
            </linearGradient>
          </defs>
        </svg>
        <details class="chart-data">
          <summary>View chart data</summary>
          <table [attr.aria-label]="title() + ' data'">
            <thead><tr><th scope="col">Month</th><th scope="col">{{ yKey() === 'on_time_pct' ? 'On time (%)' : 'Value' }}</th></tr></thead>
            <tbody>
              @for (row of data(); track $index) {
                <tr><th scope="row">{{ row[xKey()] }}</th><td>{{ row[yKey()] }}</td></tr>
              }
            </tbody>
          </table>
        </details>
      }
    </div>
  `,
  styleUrls: ['./skeleton.css'],
  styles: [`
    .chart-card {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px 18px;
      border: 1px solid var(--tplane-chat-separator);
      border-radius: var(--tplane-chat-radius-card);
      background: var(--tplane-chat-surface-alt);
      backdrop-filter: blur(4px);
    }
    .chart-card__title {
      font-size: 13px;
      font-weight: 600;
      color: var(--tplane-chat-text-muted);
      letter-spacing: 0.01em;
    }
    .chart-card__svg {
      width: 100%;
      height: auto;
      max-height: 280px;
      display: block;
    }
  `],
})
export class LineChartComponent {
  protected readonly gradientId = `dashboard-line-${nextLineChartId++}`;
  readonly title = input<string>('');
  readonly data = input<Record<string, unknown>[] | null>(null);
  readonly xKey = input<string>('');
  readonly yKey = input<string>('');

  readonly width = 400;
  readonly height = 220;
  readonly padding = { top: 16, right: 32, bottom: 28, left: 64 };

  readonly isSkeleton = computed(() => this.data() == null);

  private readonly domain = computed(() => {
    const values = (this.data() ?? []).map(item => Number(item[this.yKey()]) || 0);
    if (!values.length) return { min: 0, max: 1 };
    const min = Math.min(...values);
    const max = Math.max(...values);
    const pad = min === max ? Math.max(1, Math.abs(min) * 0.05) : 0;
    return { min: min - pad, max: max + pad };
  });

  readonly points = computed(() => {
    const d = this.data();
    if (!d || d.length === 0) return [];
    const xk = this.xKey();
    const yk = this.yKey();
    const { min: yMin, max: yMax } = this.domain();
    const yRange = yMax - yMin;
    const plotW = this.width - this.padding.left - this.padding.right;
    const plotH = this.height - this.padding.top - this.padding.bottom;

    return d.map((item, i) => ({
      x: this.padding.left + (d.length > 1 ? (i / (d.length - 1)) * plotW : plotW / 2),
      y: this.padding.top + plotH - ((Number(item[yk]) || 0) - yMin) / yRange * plotH,
      label: String(item[xk] ?? ''),
    }));
  });

  readonly polylinePoints = computed(() =>
    this.points().map(p => `${p.x},${p.y}`).join(' ')
  );

  readonly areaPath = computed((): string => {
    const pts = this.points();
    if (pts.length === 0) return '';
    const baseline = this.padding.top + (this.height - this.padding.top - this.padding.bottom);
    const top = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    return `${top} L ${pts[pts.length - 1].x} ${baseline} L ${pts[0].x} ${baseline} Z`;
  });

  readonly xLabels = computed(() => {
    const pts = this.points();
    const plotWidth = this.width - this.padding.left - this.padding.right;
    const step = Math.max(1, Math.ceil((pts.length - 1) * 64 / plotWidth));
    const count = Math.min(4, Math.floor((pts.length - 1) / step) + 1);
    if (pts.length <= count) return pts;
    return Array.from({ length: count }, (_, index) =>
      pts[Math.round(index * (pts.length - 1) / (count - 1))]
    );
  });

  readonly yGridLines = computed(() => {
    const d = this.data();
    if (!d || d.length === 0) return [];
    const { min: yMin, max: yMax } = this.domain();
    const plotH = this.height - this.padding.top - this.padding.bottom;
    const mid = (yMin + yMax) / 2;
    return [
      { value: yMax, y: this.padding.top, label: this.formatNumber(yMax) },
      { value: mid, y: this.padding.top + plotH / 2, label: this.formatNumber(mid) },
      { value: yMin, y: this.padding.top + plotH, label: this.formatNumber(yMin) },
    ];
  });

  private formatNumber(n: number): string {
    const { min, max } = this.domain();
    const scale = Math.abs(n) >= 1000 && max - min >= 1000 ? 1000 : 1;
    const precision = Math.min(10, Math.max(0, -Math.floor(Math.log10((max - min) / (2 * scale)))));
    return `${(n / scale).toFixed(precision)}${scale === 1000 ? 'k' : ''}`;
  }
}
