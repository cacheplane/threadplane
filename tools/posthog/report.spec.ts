import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sparkline, formatDeltaCell, renderReport, insightReportRows, generateReport, BREAKDOWN_TOTAL_SUFFIX } from './report.js';

const asOf = new Date('2026-09-07T17:45:00Z');
const dayMs = 86_400_000;
const today = Date.parse('2026-09-07T00:00:00Z');
const days = Array.from({ length: 28 }, (_, index) => new Date(today - (28 - index) * dayMs).toISOString().slice(0, 10));
const dailySource = { kind: 'TrendsQuery', interval: 'day', series: [{ math: 'total' }] };

test('report fetches dashboard details when paginated list summaries omit tiles and excludes untracked dashboards', async () => {
  const details: number[] = [];
  const offsets: number[] = [];
  const client = { async GET(path: string, options: any) {
    if (path === '/dashboards/') {
      const offset = options.params.query.offset ?? 0;
      offsets.push(offset);
      return { data: offset === 0
        ? { results: [{ id: 99, name: 'Legacy', tags: ['gtm'] }], next: 'next' }
        : { results: [{ id: 10, name: 'Managed', tags: ['gtm'] }], next: null } };
    }
    if (path === '/dashboards/{id}/') {
      details.push(options.params.path.id);
      return { data: { id: 10, name: 'Managed', tiles: [{ insight: { id: 7 } }] } };
    }
    assert.equal(path, '/insights/{id}/');
    assert.equal(options.params.path.id, 7);
    return { data: { id: 7, name: 'Accepted', query: { source: dailySource }, result: [{ days, data: Array(28).fill(1) }] } };
  } };
  const report = await generateReport({ client, asOf, dashboardIds: [10] });
  assert.deepEqual(offsets, [0, 1]);
  assert.deepEqual(details, [10]);
  assert.match(report.markdown, /\| Accepted \| 7 \| 7/);
  assert.doesNotMatch(report.markdown, /Legacy/);
});

test('report refuses missing dashboard tile data instead of rendering an empty section', async () => {
  const client = { async GET(path: string) {
    return { data: path === '/dashboards/'
      ? { results: [{ id: 10, name: 'Managed', tags: ['gtm'] }] }
      : { id: 10, name: 'Managed' } };
  } };
  await assert.rejects(generateReport({ client, asOf, dashboardIds: [10] }), /tiles/i);
});

test('report identifies a dashboard with no insight tiles as unavailable', async () => {
  const client = { async GET(path: string) {
    return { data: path === '/dashboards/'
      ? { results: [{ id: 10, name: 'Managed', tags: ['gtm'] }] }
      : { id: 10, name: 'Managed', tiles: [] } };
  } };
  const report = await generateReport({ client, asOf, dashboardIds: [10] });
  assert.match(report.markdown, /Unavailable: no insight tiles/);
});

test('report prefers custom series names over identical raw event labels', () => {
  const source = { ...dailySource, series: [{ math: 'total', custom_name: 'Dialog opened' }, { math: 'total', custom_name: 'Copy attempted' }] };
  const rows = insightReportRows({ id: 1, name: 'Intent', query: { source }, result: [{ label: 'marketing:cta_click', days, data: Array(28).fill(1) }, { label: 'marketing:cta_click', days, data: Array(28).fill(2) }] }, asOf);
  assert.deepEqual(rows.map(row => row.metric), ['Intent — Dialog opened', 'Intent — Copy attempted']);
});

test('report keeps additive series separate and never sums unique daily actors into weekly users', () => {
  const source = { kind: 'TrendsQuery', interval: 'day', series: [{ math: 'total' }, { math: 'total' }] };
  const rows = insightReportRows({ id: 1, name: 'Runtime', query: { kind: 'InsightVizNode', source }, result: [{ label: 'Starts', days, data: Array(28).fill(1) }, { label: 'Ends', days, data: Array(28).fill(2) }] }, asOf);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map(row => row.thisWeek), [7, 14]);
  const unique = insightReportRows({ id: 2, name: 'Users', query: { source: { ...source, series: [{ math: 'dau' }] } }, result: [{ data: Array(28).fill(1) }] });
  assert.equal(unique[0].thisWeek, null);
  assert.match(unique[0].unavailable ?? '', /unique/i);
});

test('report uses dated completed UTC days, ignoring older data and the partial current day', () => {
  // Reverse order deliberately: dates, rather than array position, define the window.
  const resultDays = [...days, '2026-09-07', '2026-08-09'].reverse();
  const data = [...days.map((_, index) => index + 1), 10_000, 20_000].reverse();
  const rows = insightReportRows({ id: 1, name: 'Dated', query: { source: dailySource }, result: [{ days: resultDays, data }] }, asOf);
  assert.deepEqual(rows[0].weeks, [28, 77, 126, 175]);
  assert.equal(rows[0].thisWeek, 175);
  assert.equal(rows[0].lastWeek, 126);
});

test('report rejects stale, undated, duplicate, gapped, partial and mismatched result dates', () => {
  const invalidDays = [
    undefined,
    days.map((day) => new Date(Date.parse(day) - dayMs).toISOString().slice(0, 10)),
    [days[1], ...days.slice(1)],
    [...days.slice(0, 10), ...days.slice(11), '2026-09-07'],
    [...days.slice(0, -1), '2026-09-06T12:00:00Z'],
    days.slice(1),
  ];
  for (const resultDays of invalidDays) {
    const rows = insightReportRows({ id: 1, name: 'Invalid', query: { source: dailySource }, result: [{ days: resultDays, data: Array(28).fill(1) }] }, asOf);
    assert.equal(rows[0].thisWeek, null, JSON.stringify(resultDays));
    assert.match(rows[0].unavailable ?? '', /date|UTC|complete/i);
  }
});

test('report never replaces a missing completed date with a zero', () => {
  const rows = insightReportRows({ id: 1, name: 'Missing', query: { source: dailySource }, result: [{ days: days.slice(0, -1), data: Array(27).fill(0) }] }, asOf);
  assert.equal(rows[0].thisWeek, null);
  assert.deepEqual(rows[0].weeks, []);
});

test('report labels funnels and missing or incomplete results unavailable instead of zero', () => {
  for (const insight of [
    { id: 1, name: 'Funnel', query: { source: { kind: 'FunnelsQuery' } }, result: [] },
    { id: 2, name: 'Missing', query: { source: { kind: 'TrendsQuery', interval: 'day', series: [{ math: 'total' }] } } },
    { id: 3, name: 'Short', query: { source: { kind: 'TrendsQuery', interval: 'day', series: [{ math: 'total' }] } }, result: [{ data: [1, 2] }] },
  ]) {
    const rows = insightReportRows(insight);
    assert.equal(rows[0].thisWeek, null);
    assert.match(renderReport([{ name: 'GTM', rows }], '2026-09-07'), /Unavailable/);
  }
});

test('sparkline: empty array returns dash', () => {
  assert.equal(sparkline([]), '—');
});

test('sparkline: maps values to 8-bar palette', () => {
  assert.equal(sparkline([0, 1, 2, 4, 8]), '▁▂▃▅█');
});

test('sparkline: all zeros returns flat low bars', () => {
  assert.equal(sparkline([0, 0, 0, 0]), '▁▁▁▁');
});

test('formatDeltaCell: zero last week with positive this week returns "new"', () => {
  const cell = formatDeltaCell({ thisWeek: 5, lastWeek: 0 });
  assert.match(cell, /\+5 \(new\)/);
});

test('formatDeltaCell: standard percent diff', () => {
  const cell = formatDeltaCell({ thisWeek: 120, lastWeek: 100 });
  assert.match(cell, /\+20 \(\+20%\)/);
});

test('formatDeltaCell: negative diff', () => {
  const cell = formatDeltaCell({ thisWeek: 80, lastWeek: 100 });
  assert.match(cell, /-20 \(-20%\)/);
});

test('renderReport: produces stable markdown structure', () => {
  const out = renderReport(
    [{ name: 'GTM · Test', rows: [{ metric: 'X', thisWeek: 10, lastWeek: 5, weeks: [1, 2, 3, 10] }] }],
    '2026-05-14',
  );
  assert.match(out, /^# GTM weekly snapshot — 2026-05-14/);
  assert(out.includes('## GTM · Test'));
  assert(out.includes('## Notes'));
  assert(out.includes('<!-- HUMAN:'));
  assert(out.includes('| X '));
  assert(out.includes('Last 7 complete UTC days'));
  assert(out.includes('Preceding 7 UTC days'));
});

const breakdownSource = { kind: 'TrendsQuery', interval: 'day', series: [{ math: 'total' }], breakdownFilter: { breakdown_type: 'event', breakdown: 'cta_id', breakdown_limit: 15 } };

function dashboardClient(insight: any, extra: Record<string, unknown> = {}) {
  return { async GET(path: string, options: any) {
    if (path === '/dashboards/') return { data: { results: [{ id: 10, name: 'Managed', tags: ['gtm'] }], next: null } };
    if (path === '/dashboards/{id}/') return { data: { id: 10, name: 'Managed', tiles: [{ insight: { id: 7 } }] } };
    assert.equal(path, '/insights/{id}/');
    assert.equal(options.params.query.refresh, 'blocking');
    return { data: insight };
  }, ...extra };
}

test('report fetches insights with a refresh that recomputes a stale cache', async () => {
  const refreshes: string[] = [];
  const client = { async GET(path: string, options: any) {
    if (path === '/dashboards/') return { data: { results: [{ id: 10, name: 'Managed' }], next: null } };
    if (path === '/dashboards/{id}/') return { data: { id: 10, name: 'Managed', tiles: [{ insight: 7 }] } };
    refreshes.push(options.params.query.refresh);
    return { data: { id: 7, name: 'Accepted', query: { source: dailySource }, result: [{ days, data: Array(28).fill(1) }] } };
  } };
  const report = await generateReport({ client, asOf, dashboardIds: [10] });
  assert.deepEqual(refreshes, ['blocking']);
  assert.match(report.markdown, /\| Accepted \| 7 \| 7/);
});

test('report totals a breakdown insight by re-running the query without the breakdown', async () => {
  const bodies: any[] = [];
  const client = dashboardClient(
    { id: 7, name: 'Install clicks', query: { source: breakdownSource }, result: [{ days, data: Array(28).fill(1), label: 'hero_install' }] },
    { async POST(path: string, options: any) {
      assert.equal(path, '/query/');
      bodies.push(options.body);
      return { data: { results: [{ days, data: Array(28).fill(3) }] } };
    } },
  );
  const report = await generateReport({ client, asOf, dashboardIds: [10] });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0].refresh, 'blocking');
  assert.equal(bodies[0].query.kind, 'TrendsQuery');
  assert.equal(bodies[0].query.breakdownFilter, undefined);
  assert.match(report.markdown, new RegExp(`Install clicks${BREAKDOWN_TOTAL_SUFFIX} \\| 21 \\| 21`));
  assert.doesNotMatch(report.markdown, /Unavailable/);
});

test('report still refuses non-daily, non-trends and non-additive insights', () => {
  const cases: Array<[any, RegExp]> = [
    [{ id: 1, name: 'Weekly', query: { source: { ...dailySource, interval: 'week' } }, result: [{ days, data: Array(28).fill(1) }] }, /daily/i],
    [{ id: 2, name: 'Funnel', query: { source: { kind: 'FunnelsQuery' } }, result: [] }, /unsupported/i],
    [{ id: 3, name: 'Uniques', query: { source: { ...dailySource, series: [{ math: 'dau' }] } }, result: [{ days, data: Array(28).fill(1) }] }, /unique/i],
  ];
  for (const [insight, reason] of cases) {
    const rows = insightReportRows(insight, asOf);
    assert.equal(rows[0].thisWeek, null);
    assert.match(rows[0].unavailable ?? '', reason);
  }
});

test('report refuses a breakdown total whose recomputed series is short or missing', async () => {
  for (const data of [undefined, { results: [{ days: days.slice(0, 10), data: Array(10).fill(1) }] }]) {
    const client = dashboardClient(
      { id: 7, name: 'Install clicks', query: { source: breakdownSource }, result: [] },
      { async POST() { return { data: data ?? { results: [] } }; } },
    );
    const report = await generateReport({ client, asOf, dashboardIds: [10] });
    assert.match(report.markdown, /Unavailable/);
  }
});

test('report polls a bounded number of times when PostHog answers with a pending query status', async () => {
  const waits: number[] = [];
  let calls = 0;
  const client = { async GET(path: string) {
    if (path === '/dashboards/') return { data: { results: [{ id: 10, name: 'Managed' }], next: null } };
    if (path === '/dashboards/{id}/') return { data: { id: 10, name: 'Managed', tiles: [{ insight: 7 }] } };
    calls += 1;
    return { data: { id: 7, name: 'Pending', query: { source: dailySource }, query_status: { complete: false } } };
  } };
  const report = await generateReport({ client, asOf, dashboardIds: [10], sleep: async (ms: number) => { waits.push(ms); } });
  assert.equal(calls, 11);
  assert.equal(waits.length, 10);
  assert.match(report.markdown, /Pending \| Unavailable/);
});
