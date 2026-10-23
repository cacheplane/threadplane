import { createServer } from 'node:http';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { expect, it, vi, onTestFinished } from 'vitest';
import { createConnectedApplication } from './connection';
async function fixture() {
  const location = new URL(
    '../../../../../scripts/react-cockpit/chat-generative-ui-fixture.mjs',
    import.meta.url
  ).href;
  const { createChatGenerativeUiFixture } = await import(
    /* @vite-ignore */ location
  );
  const handle = createChatGenerativeUiFixture();
  const server = createServer(async (req, res) => {
    if (
      !(await handle(
        req,
        res,
        new URL(req.url ?? '', 'http://localhost').pathname
      ))
    ) {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const app = createConnectedApplication({
    apiUrl: base + '/api',
    headers: {},
  });
  onTestFinished(async () => {
    await app.dispose();
    await handle.close();
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  });
  const control = async (body: object) => {
    expect(
      (
        await fetch(base + '/__configure', {
          method: 'POST',
          body: JSON.stringify(body),
        })
      ).status
    ).toBe(200);
  };
  const requests = async () =>
    (await (await fetch(base + '/__requests')).json()) as {
      path: string;
      method: string;
      body: Record<string, unknown>;
    }[];
  return { app, base, control, requests };
}
it('actual default session confirms initial, cancelled filter, structural and prose turns with exact requests', async () => {
  const f = await fixture();
  expect(await f.requests()).toEqual([]);
  const states: ReturnType<typeof f.app.getSnapshot>[] = [];
  f.app.subscribe(() => states.push(f.app.getSnapshot()));
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const initial = f.app.getSnapshot();
  expect(initial.surfaces).toHaveLength(1);
  expect(Object.keys(initial.dashboard)).toHaveLength(7);
  expect(await f.app.submit('Filter to cancelled flights')).toBe(true);
  const filtered = f.app.getSnapshot();
  expect(filtered.surfaces).toEqual(initial.surfaces);
  expect(
    filtered.dashboard.recent_disruptions?.every((r) => r.type === 'cancelled')
  ).toBe(true);
  expect(await f.app.submit('Remove the table')).toBe(true);
  expect(f.app.getSnapshot().surfaces).toHaveLength(2);
  const structured = f.app.getSnapshot();
  expect(await f.app.submit('Why is on-time low?')).toBe(true);
  expect(f.app.getSnapshot().dashboard).toEqual(structured.dashboard);
  expect(f.app.getSnapshot().surfaces).toEqual(structured.surfaces);
  for (const s of states)
    if (s.busy && s.activity === 'confirming')
      expect(s.surfaces.length).toBeLessThanOrEqual(2);
  const requests = await f.requests();
  expect(requests).toHaveLength(17);
  expect(requests.filter((r) => r.path === '/api/threads')).toHaveLength(1);
  expect(requests.filter((r) => r.path.endsWith('/runs/stream'))).toHaveLength(
    4
  );
  expect(
    requests.filter((r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path))
  ).toHaveLength(4);
  expect(requests.filter((r) => r.path.endsWith('/history'))).toHaveLength(4);
  expect(
    requests.filter((r) => r.path.endsWith('/state/checkpoint'))
  ).toHaveLength(4);
}, 60000);
it('actual nonempty-parent render keeps prose and raw result without mounting a new layout', async () => {
  const f = await fixture();
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const prior = f.app.getSnapshot();
  expect(await f.app.submit('prose render')).toBe(true);
  expect(f.app.getSnapshot().surfaces).toEqual(prior.surfaces);
  expect(f.app.getSnapshot().notices).toHaveLength(1);
  const last = f.app.getSnapshot().toolCalls.at(-1);
  expect(last?.status === 'complete' && last.result).not.toBe('rendered');
}, 60000);
it.each(['missing', 'invalid'])(
  'actual %s decision confirms an honest saved no-op with the prior dashboard',
  async (decisionFault) => {
    const f = await fixture();
    expect(await f.app.submit('Show dashboard')).toBe(true);
    const prior = f.app.getSnapshot();
    await f.control({ decisionFault });
    expect(await f.app.submit('Filter to cancelled flights')).toBe(true);
    const saved = f.app.getSnapshot();
    expect(saved.dashboard).toEqual(prior.dashboard);
    expect(saved.surfaces).toEqual(prior.surfaces);
    expect(saved.toolCalls).toEqual(prior.toolCalls);
    expect(saved.messages.at(-1)?.content).toContain(
      'No dashboard changes were made.'
    );
    expect(saved.canSubmit).toBe(true);
    expect(
      (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(2);
  },
  60000
);
it.each(['failKpis', 'malformedTrend'])(
  'actual %s structural rollback stays unconfirmed with real successful peers',
  async (toolFault) => {
    const f = await fixture();
    await f.control({ partialDashboard: true });
    expect(await f.app.submit('Show dashboard')).toBe(true);
    const prior = f.app.getSnapshot();
    expect(Object.keys(prior.dashboard).sort()).toEqual([
      'flights_by_airline',
      'recent_disruptions',
    ]);
    await f.control({ partialDashboard: false, [toolFault]: true });
    expect(await f.app.submit('Show another dashboard')).toBe(false);
    const failed = f.app.getSnapshot();
    expect(failed.dashboard).toBe(prior.dashboard);
    expect(failed.surfaces).toBe(prior.surfaces);
    expect(failed.canSubmit).toBe(false);
    const render = failed.toolCalls
      .filter((c) => c.name === 'render_spec')
      .at(-1);
    expect(render?.status === 'complete' && render.result).not.toBe('rendered');
    const peer = failed.toolCalls.find((c) => c.name === 'query_on_time_trend');
    expect(peer?.status).toBe('complete');
    const count = (await f.requests()).length;
    expect(await f.app.submit('Try again')).toBe(false);
    expect(await f.requests()).toHaveLength(count);
    await f.app.newConversation();
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: true,
      surfaces: [],
      dashboard: {},
    });
  },
  60000
);
it('actual failed read-only interpretation retains the confirmed dashboard and requires New', async () => {
  const f = await fixture();
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const prior = f.app.getSnapshot();
  await f.control({ failInterpretation: true });
  expect(await f.app.submit('Why is on-time low?')).toBe(false);
  expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
  expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(
    (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(2);
}, 60000);
it('actual pending task rejects confirmation and Stop preserves the confirmed board without retry', async () => {
  const f = await fixture();
  expect(await f.app.submit('Show dashboard')).toBe(true);
  const prior = f.app.getSnapshot();
  await f.control({ stateFault: 'pending-tasks' });
  expect(await f.app.submit('Filter to cancelled flights')).toBe(false);
  expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
  expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  await f.app.newConversation();
  await f.control({ stateFault: null, holdStream: true });
  const pending = f.app.submit('Show dashboard');
  await vi.waitFor(async () =>
    expect(
      (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
    ).toHaveLength(3)
  );
  await f.app.stop();
  await pending;
  expect(f.app.getSnapshot().canSubmit).toBe(false);
  expect(
    (await f.requests()).filter((r) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(3);
}, 60000);
it.each([
  'missing-terminal',
  'stale-terminal',
  'foreign-terminal',
  'old-message',
  'old-data',
  'incomplete-tools',
  'malformed-layout',
  'missing-dashboard',
  'disagreeing-dashboard',
  'task-error',
])(
  'actual saved %s fault cannot replace confirmed data or layouts',
  async (fault) => {
    const f = await fixture();
    expect(await f.app.submit('Show dashboard')).toBe(true);
    const prior = f.app.getSnapshot();
    await f.control({ stateFault: fault });
    expect(
      await f.app.submit(
        fault === 'malformed-layout'
          ? 'Remove the table'
          : 'Filter to cancelled flights'
      )
    ).toBe(false);
    expect(f.app.getSnapshot().dashboard).toBe(prior.dashboard);
    expect(f.app.getSnapshot().surfaces).toBe(prior.surfaces);
    expect(f.app.getSnapshot().canSubmit).toBe(false);
    const count = (await f.requests()).length;
    expect(await f.app.submit('Follow up')).toBe(false);
    expect(await f.requests()).toHaveLength(count);
  },
  60000
);
it.each(['running', 'error'])(
  'actual independent exact run status %s cannot grant confirmation',
  async (runStatus) => {
    const f = await fixture();
    await f.control({ runStatus });
    expect(await f.app.submit('Show dashboard')).toBe(false);
    expect(f.app.getSnapshot()).toMatchObject({
      canSubmit: false,
      surfaces: [],
      dashboard: {},
    });
    expect(
      (await f.requests()).filter(
        (r) => r.method === 'GET' && /\/runs\/[^/]+$/.test(r.path)
      )
    ).toHaveLength(1);
  },
  60000
);
