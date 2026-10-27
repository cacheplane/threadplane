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
        <p className="dashboard-delta">{text(props.delta)}</p>
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
  const title =
    text(props.title) ||
    (kind === 'line' ? 'On-time trend' : 'Flights by airline');
  const points = chartPoints(
    props.data,
    kind === 'line' ? 'month' : 'airline',
    kind === 'line' ? 'on_time_pct' : 'count'
  );
  const maximum =
    kind === 'line'
      ? 100
      : Math.max(1, ...(points?.map((point) => point.value) ?? []));
  const x = (index: number) =>
    points!.length === 1 ? 160 : 24 + (index * 272) / (points!.length - 1);
  const y = (value: number) => 132 - (value / maximum) * 108;
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
          <svg viewBox="0 0 320 156" role="img" aria-label={title}>
            <line x1="24" y1="132" x2="296" y2="132" className="chart-axis" />
            {kind === 'line' && (
              <polyline
                points={points
                  .map((point, index) => `${x(index)},${y(point.value)}`)
                  .join(' ')}
                className="chart-line"
              />
            )}
            {points.map((point, index) =>
              kind === 'line' ? (
                <circle
                  key={index}
                  cx={x(index)}
                  cy={y(point.value)}
                  r="4"
                  className="chart-point"
                >
                  <title>
                    {point.label}: {point.value}%
                  </title>
                </circle>
              ) : (
                <rect
                  key={index}
                  x={24 + (index * 272) / points.length + 4}
                  y={y(point.value)}
                  width={Math.max(1, 272 / points.length - 8)}
                  height={132 - y(point.value)}
                  className="chart-bar"
                >
                  <title>
                    {point.label}: {point.value}
                  </title>
                </rect>
              )
            )}
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
