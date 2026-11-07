import { Children, useId, type CSSProperties } from 'react';
import type {
  ReactRenderRegistry,
  RenderViewProps,
  RenderValue,
} from '@threadplane/react/render';

const text = (value: RenderValue) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function Waiting() {
  return <p className="dashboard-empty">Waiting for dashboard data…</p>;
}
function DashboardGrid({ children }: RenderViewProps) {
  return (
    <div className="dashboard-grid" data-dashboard-view="dashboard_grid">
      {children}
    </div>
  );
}
function Container({ props, children }: RenderViewProps) {
  return (
    <div
      className="dashboard-container"
      data-dashboard-view="container"
      data-direction={props.direction === 'row' ? 'row' : 'column'}
      style={
        {
          '--dashboard-cols': Math.max(1, Children.count(children)),
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
function StatCard({ props }: RenderViewProps) {
  return (
    <section
      className="dashboard-card"
      data-dashboard-view="stat_card"
      aria-label={text(props.label)}
    >
      <h3>{text(props.label)}</h3>
      {props.value === undefined || props.value === null ? (
        <Waiting />
      ) : (
        <p className="dashboard-metric">{text(props.value)}</p>
      )}
      {props.delta !== null && props.delta !== undefined && (
        <p
          className="dashboard-delta"
          data-trend={
            text(props.delta).startsWith('+')
              ? 'up'
              : /^[-−]/.test(text(props.delta))
              ? 'down'
              : 'flat'
          }
        >
          {text(props.delta)}
        </p>
      )}
    </section>
  );
}
type Point = Readonly<{ label: string; value: number }>;
function chartPoints(
  value: RenderValue,
  labelKey: string,
  valueKey: string
): readonly Point[] | undefined {
  if (!Array.isArray(value)) return;
  return value.map((row) => {
    const record = row as Readonly<Record<string, RenderValue>>;
    return { label: text(record[labelKey]), value: Number(record[valueKey]) };
  });
}
function Chart({
  props,
  kind,
}: RenderViewProps & { readonly kind: 'line' | 'bar' }) {
  const gradientId = useId();
  const title =
    text(props.title) ||
    (kind === 'line' ? 'On-time trend' : 'Flights by airline');
  const points = chartPoints(
    props.data,
    kind === 'line' ? 'month' : 'airline',
    kind === 'line' ? 'on_time_pct' : 'count'
  );
  const values = points?.map((point) => point.value) ?? [];
  const rawMinimum = kind === 'line' && values.length ? Math.min(...values) : 0;
  const rawMaximum =
    kind === 'line' && values.length
      ? Math.max(...values)
      : Math.max(1, ...values);
  const domainPadding =
    kind === 'line' && rawMinimum === rawMaximum
      ? Math.max(1, Math.abs(rawMinimum) * 0.05)
      : 0;
  const minimum = rawMinimum - domainPadding;
  const maximum = rawMaximum + domainPadding;
  const range = maximum - minimum || 1;
  const padding =
    kind === 'line'
      ? { top: 16, right: 32, bottom: 28, left: 64 }
      : { top: 28, right: 16, bottom: 28, left: 16 };
  const plotWidth = 400 - padding.left - padding.right;
  const plotHeight = 220 - padding.top - padding.bottom;
  const baseline = 220 - padding.bottom;
  const x = (index: number) =>
    (points?.length ?? 0) === 1
      ? padding.left + plotWidth / 2
      : padding.left + (index * plotWidth) / ((points?.length ?? 0) - 1);
  const y = (value: number) =>
    padding.top + plotHeight - ((value - minimum) / range) * plotHeight;
  const labelStep = Math.max(
    1,
    Math.ceil((((points?.length ?? 1) - 1) * 64) / plotWidth)
  );
  const labelCount =
    kind === 'line'
      ? Math.min(4, Math.floor(((points?.length ?? 1) - 1) / labelStep) + 1)
      : 4;
  const labelIndices =
    (points?.length ?? 0) <= labelCount
      ? points?.map((_, index) => index) ?? []
      : Array.from({ length: labelCount }, (_, index) =>
          Math.round((index * ((points?.length ?? 0) - 1)) / (labelCount - 1))
        );
  const numberLabel = (value: number) => {
    const scale = Math.abs(value) >= 1000 && range >= 1000 ? 1000 : 1;
    const precision = Math.min(
      10,
      Math.max(0, -Math.floor(Math.log10(range / (2 * scale))))
    );
    return `${(value / scale).toFixed(precision)}${scale === 1000 ? 'k' : ''}`;
  };
  const barGap = Math.min(12, plotWidth / (2 * (points?.length || 1)));
  const barWidth =
    (plotWidth - barGap * ((points?.length || 1) - 1)) / (points?.length || 1);
  const barX = (index: number) => padding.left + index * (barWidth + barGap);
  return (
    <section
      className="dashboard-card dashboard-chart"
      data-dashboard-view={kind === 'line' ? 'line_chart' : 'bar_chart'}
    >
      <h3>{title}</h3>
      {!points ? (
        <Waiting />
      ) : points.length === 0 ? (
        <p className="dashboard-empty">No chart data.</p>
      ) : (
        <>
          <svg viewBox="0 0 400 220" role="img" aria-label={title}>
            {kind === 'line' ? (
              <>
                {[maximum, (minimum + maximum) / 2, minimum].map(
                  (value, index) => {
                    const tickY = padding.top + (index * plotHeight) / 2;
                    return (
                      <g key={index}>
                        <line
                          x1={padding.left}
                          y1={tickY}
                          x2={400 - padding.right}
                          y2={tickY}
                          className="chart-axis"
                        />
                        <text
                          x={padding.left - 8}
                          y={tickY + 4}
                          textAnchor="end"
                        >
                          {numberLabel(value)}
                        </text>
                      </g>
                    );
                  }
                )}
                <path
                  d={`${points
                    .map(
                      (point, index) =>
                        `${index === 0 ? 'M' : 'L'} ${x(index)} ${y(
                          point.value
                        )}`
                    )
                    .join(' ')} L ${x(points.length - 1)} ${baseline} L ${x(
                    0
                  )} ${baseline} Z`}
                  fill={`url(#${gradientId})`}
                />
                <polyline
                  points={points
                    .map((point, index) => `${x(index)},${y(point.value)}`)
                    .join(' ')}
                  className="chart-line"
                />
                {labelIndices.map((index) => (
                  <text key={index} x={x(index)} y={214} textAnchor="middle">
                    {points[index].label}
                  </text>
                ))}
              </>
            ) : (
              <line
                x1={padding.left}
                y1={baseline}
                x2={400 - padding.right}
                y2={baseline}
                className="chart-axis"
              />
            )}
            {points.map((point, index) =>
              kind === 'line' ? (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(point.value)}
                  r="3"
                  className="chart-point"
                >
                  <title>
                    {point.label}: {point.value}%
                  </title>
                </circle>
              ) : (
                <g key={index}>
                  <rect
                    x={barX(index)}
                    y={y(point.value)}
                    width={barWidth}
                    height={baseline - y(point.value)}
                    rx="3"
                    fill={`url(#${gradientId})`}
                    className="chart-bar"
                  >
                    <title>
                      {point.label}: {point.value}
                    </title>
                  </rect>
                  {barWidth >= 36 && (
                    <text
                      x={barX(index) + barWidth / 2}
                      y={y(point.value) - 6}
                      textAnchor="middle"
                    >
                      {point.value.toLocaleString()}
                    </text>
                  )}
                  {labelIndices.includes(index) && (
                    <text
                      x={barX(index) + barWidth / 2}
                      y={baseline + 16}
                      textAnchor="middle"
                    >
                      {point.label}
                    </text>
                  )}
                </g>
              )
            )}
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop
                  offset="0%"
                  stopColor="var(--dashboard-chart-color)"
                  stopOpacity={kind === 'line' ? 0.28 : 1}
                />
                <stop
                  offset="100%"
                  stopColor="var(--dashboard-chart-color)"
                  stopOpacity={kind === 'line' ? 0 : 0.75}
                />
              </linearGradient>
            </defs>
          </svg>
          <details className="dashboard-chart-data">
            <summary>View chart data</summary>
            <table aria-label={`${title} data`}>
              <thead>
                <tr>
                  <th scope="col">{kind === 'line' ? 'Month' : 'Airline'}</th>
                  <th scope="col">
                    {kind === 'line' ? 'On time (%)' : 'Flights'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {points.map((point, index) => (
                  <tr key={index}>
                    <th scope="row">{point.label}</th>
                    <td>{point.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}
function LineChart(props: RenderViewProps) {
  return <Chart {...props} kind="line" />;
}
function BarChart(props: RenderViewProps) {
  return <Chart {...props} kind="bar" />;
}
const columnLabels: Readonly<Record<string, string>> = {
  flight_number: 'Flight',
  type: 'Disruption',
  minutes: 'Minutes',
  route: 'Route',
  date: 'Date',
};
function DataGrid({ props }: RenderViewProps) {
  const title = text(props.title) || 'Recent disruptions';
  const rows = Array.isArray(props.rows) ? props.rows : undefined;
  const columns = (props.columns ?? []) as readonly string[];
  return (
    <section className="dashboard-card" data-dashboard-view="data_grid">
      <h3>{title}</h3>
      {!rows ? (
        <Waiting />
      ) : rows.length === 0 ? (
        <p className="dashboard-empty">No disruptions.</p>
      ) : (
        <div
          className="dashboard-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={`${title} table`}
        >
          <table aria-label={title}>
            <thead>
              <tr>
                {columns.map((column) => (
                  <th key={column} scope="col">
                    {columnLabels[column]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index}>
                  {columns.map((column) => (
                    <td key={column}>
                      {text(
                        (row as Readonly<Record<string, RenderValue>>)[column]
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Only the six validated, read-only authored dashboard views are registered. */
export const dashboardRegistry: ReactRenderRegistry = Object.freeze({
  dashboard_grid: DashboardGrid,
  container: Container,
  stat_card: StatCard,
  line_chart: LineChart,
  bar_chart: BarChart,
  data_grid: DataGrid,
});
