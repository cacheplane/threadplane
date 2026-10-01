import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startProofServer, threadEnvelope } from './proof-server.mjs';
import {
  file,
  readRetainedBuild,
  startCheckedServer,
} from './retained-build.mjs';
import { readViewProof } from './view-proof.mjs';
import { lifecycleName } from './verification-checks.mjs';

const row = (id) => threadEnvelope(id, `Conversation ${id.toUpperCase()}`);
const rows = [row('a'), row('b')];
const search = (body = rows, extra = {}) => ({
  method: 'POST',
  path: '/api/threads/search',
  payload: { limit: 50, offset: 0 },
  body,
  ...extra,
});
const lookup = (id, extra = {}) => ({
  method: 'GET',
  path: `/api/threads/${id}`,
  body: row(id),
  ...extra,
});
const history = (id, text = `Saved ${id.toUpperCase()}`, extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${id}/history`,
  payload: { limit: 10 },
  body: [
    {
      values: { messages: [{ type: 'ai', id: 'saved', content: text }] },
      next: [],
      tasks: [],
      checkpoint: { thread_id: id, checkpoint_ns: '', checkpoint_id: 'saved' },
      parent_checkpoint: null,
      metadata: { source: 'input', step: 0, parents: {} },
      created_at: '2026-09-28T00:00:00.000Z',
    },
  ],
  ...extra,
});
const values = (text) => ({
  event: 'values',
  data: { messages: [{ type: 'ai', id: 'answer', content: text }] },
});
const summaryTitle = '<img src=x onerror=alert(1)> Supplied recap';
const summaryPlace = '<script>alert(1)</script> & ' + 'LongPlace'.repeat(24);
const summaryNote = '<b>Keep this literal</b> & bring water';
const summaryCalls = [
  {
    id: 'summary-one',
    name: 'show_trip_summary',
    args: {
      title: summaryTitle,
      days: [
        { day: 1, places: [summaryPlace, summaryPlace] },
        { day: 1, places: [] },
      ],
      note: summaryNote,
    },
  },
  {
    id: 'summary-empty',
    name: 'show_trip_summary',
    args: { title: 'Empty recap', days: [] },
  },
];
const summaryMessage = {
  type: 'ai',
  id: 'summary-message',
  content: '',
  tool_calls: summaryCalls,
};
const summaryTexts = [
  summaryTitle +
    '\nDay 1: ' +
    summaryPlace +
    ' → ' +
    summaryPlace +
    '\nDay 1: No stops\n' +
    summaryNote,
  'Empty recap',
];
const summaryResults = summaryCalls.map((call, index) => ({
  id: 'client-tool-result-' + call.id,
  role: 'tool',
  type: 'tool',
  tool_call_id: call.id,
  content: summaryTexts[index],
}));
const summaryEvent = { event: 'values', data: { messages: [summaryMessage] } };
const singleSummaryMessage = {
  ...summaryMessage,
  tool_calls: [
    {
      id: 'summary-single',
      name: 'show_trip_summary',
      args: {
        title: 'One supplied day',
        days: [{ day: 2, places: ['Museum'] }],
      },
    },
  ],
};
const summaryWrite = (extra = {}) => ({
  method: 'POST',
  path: '/api/threads/a/state',
  payload: { values: { messages: summaryResults } },
  body: { checkpoint_id: 'summary-saved' },
  ...extra,
});
const summaryHistory = (complete = true, message = summaryMessage) => {
  const step = history('a');
  step.body[0].values.messages = [message, ...(complete ? summaryResults : [])];
  return step;
};
// Independent wire expectation; do not derive this from the authored catalog.
const expectedClientTools = [
  {
    name: 'show_trip_summary',
    description:
      'Show a supplied trip recap with days and places. This terminal summary needs no follow-up; it does not plan or change an itinerary.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        days: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              day: { type: 'integer', minimum: 1 },
              places: { type: 'array', items: { type: 'string' } },
            },
            required: ['day', 'places'],
          },
        },
        note: { type: 'string' },
      },
      required: ['title', 'days'],
    },
  },
];
const run = (id, text, events = [values('A response')], extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${id}/runs/stream`,
  events,
  ...extra,
  assertPayload(payload) {
    const messageId = payload?.input?.messages?.[0]?.id;
    assert.match(
      messageId,
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
    assert.deepEqual(payload, {
      assistant_id: 'assistant',
      input: {
        messages: [{ type: 'human', id: messageId, content: text }],
        client_tools: expectedClientTools,
      },
      stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
      stream_subgraphs: true,
      stream_resumable: true,
      on_disconnect: 'continue',
    });
  },
});
const create = (extra = {}) => ({
  method: 'POST',
  path: '/api/threads',
  payload: { metadata: {} },
  body: row('new'),
  ...extra,
});
const approvalId = '0123456789abcdef0123456789abcdef';
const approvalReason =
  '  <img src=x onerror=alert(1)>\nReview & decide: ' +
  'literal'.repeat(30) +
  '  ';
const approvalInterrupt = (reason = approvalReason) => ({
  id: approvalId,
  value: { type: 'approval_request', reason },
});
const approvalHistory = (id) => {
  const step = history(id);
  step.body[0].tasks = [
    {
      id: 'approval-task',
      name: 'request_approval',
      interrupts: [approvalInterrupt()],
    },
  ];
  step.body[0].next = ['request_approval'];
  return step;
};
const resume = (id, answer, events, extra = {}) => ({
  method: 'POST',
  path: `/api/threads/${id}/runs/stream`,
  payload: {
    assistant_id: 'assistant',
    input: null,
    command: { resume: { [approvalId]: answer } },
    stream_mode: ['values', 'messages-tuple', 'updates', 'custom'],
    stream_subgraphs: true,
    stream_resumable: true,
    on_disconnect: 'continue',
  },
  events,
  ...extra,
});
const initial = (id = 'a', extra = {}) => [
  search(rows, { concurrentGroup: 'initial', ...extra }),
  lookup(id, { concurrentGroup: 'initial' }),
  history(id),
];
const deadline = async (promise, label) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(Error(`Timed out: ${label}`)), 10000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};
const physicallyClosed = async (step) =>
  assert.equal(
    (await deadline(step.closed, 'physical request close before cleanup'))
      .finished,
    false
  );

async function scenario(browser, retained, name, expectations, action) {
  const backend = await startProofServer(expectations);
  let server, context, page;
  const errors = [],
    consoleErrors = [],
    failures = [];
  try {
    server = await startCheckedServer({
      retained,
      target: backend.origin + '/api',
    });
    context = await browser.newContext();
    page = await context.newPage();
    page.setDefaultTimeout(10000);
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error')
        consoleErrors.push({
          text: message.text(),
          url: message.location().url,
        });
    });
    page.on('response', (response) => {
      if (response.status() >= 400)
        failures.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
        });
    });
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === server.url)
        return route.continue();
      errors.push(`Unexpected external request: ${route.request().url()}`);
      return route.abort();
    });
    const { expect } = await import('@playwright/test');
    const evidence = await action({ page, expect, backend, url: server.url });
    backend.verify();
    assert.deepEqual(errors, [], `${name}: page errors`);
    const expectedFailures = expectations
      .filter((step) => (step.status ?? 200) >= 400)
      .map((step) => ({ path: step.path, status: step.status }));
    assert.deepEqual(failures, expectedFailures, `${name}: failed responses`);
    for (const error of consoleErrors) {
      const failure = failures.find(
        (failure) => new URL(error.url).pathname === failure.path
      );
      assert.ok(failure, `${name}: unexpected console error ${error.text}`);
      assert.equal(
        error.text,
        `Failed to load resource: the server responded with a status of ${failure.status} (Service Unavailable)`
      );
    }
    return {
      name,
      requests: backend.requests.map(({ method, path, payload }) => ({
        method,
        path,
        payload,
      })),
      evidence: evidence ?? {},
      passed: true,
    };
  } catch (error) {
    console.error(
      'Browser proof failed:',
      JSON.stringify({
        name,
        url: page?.url(),
        dom: await page
          ?.locator('body')
          .innerText()
          .catch(() => null),
        requests: backend.requests.map(({ method, path, payload }) => ({
          method,
          path,
          payload,
        })),
        errors,
        consoleErrors,
        failures,
      })
    );
    throw error;
  } finally {
    await context?.close();
    await server?.close();
    await backend.close();
  }
}

const ready = async (page, expect) => {
  // Admission belongs to the rendered selection, which may lag the URL until
  // the framework commits its scheduled render after a click or popstate.
  const id = new URL(page.url()).searchParams.get('thread');
  assert.ok(id, 'Ready requires a selected conversation');
  await expect(page.locator('.conversation-id')).toHaveText(
    'Conversation ID: ' + id
  );
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true })
  ).toBeEnabled();
};
const select = (page, id) =>
  page
    .getByRole('button', {
      name: `Conversation ${id.toUpperCase()}`,
      exact: true,
    })
    .click();
const submit = async (page, text) => {
  const draft = page.getByRole('textbox', { name: 'Message', exact: true });
  await draft.fill(text);
  await draft.press('Control+Enter');
};

export async function runViewProof(browser, retained) {
  return scenario(
    browser,
    retained,
    lifecycleName(retained.framework),
    [
      ...initial(),
      run('a', 'Show the supplied recap.', [
        {
          event: 'values',
          data: {
            messages: [
              { ...summaryMessage, reasoning: 'Saved recap reasoning' },
            ],
          },
        },
      ]),
      summaryWrite(),
      run(
        'a',
        'Keep working while the view is absent.',
        [
          {
            event: 'messages',
            data: [
              {
                type: 'AIMessageChunk',
                id: 'absent-answer',
                content: '# Updated while absent',
                reasoning: '**Reasoning updated while absent**',
              },
              {},
            ],
          },
        ],
        { holdHeaders: true, holdBody: true }
      ),
    ],
    async ({ page, expect, backend, url }) => {
      await page.goto(url + '/?thread=a');
      await ready(page, expect);
      await expect
        .poll(() =>
          page.evaluate(() => window.nativeViewProof?.inspect().active)
        )
        .toBe(1);
      await submit(page, 'Show the supplied recap.');
      await expect(
        page.getByRole('region', { name: 'Trip summary', exact: true })
      ).toHaveCount(2);
      await expect(
        page.getByText('Response complete.', { exact: true })
      ).toBeVisible();
      assert.equal(backend.requests.length, 5);
      await submit(page, 'Keep working while the view is absent.');
      await deadline(backend.steps[5].received, 'held view request');
      await page.evaluate(() => window.nativeViewProof.mark('mounted'));
      const before = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
      assert.equal(before.tripSummaryCount, 2);
      assert.ok(before.reasoning.includes('Saved recap reasoning'));
      await page.evaluate(() => window.nativeViewProof.unmount());
      await expect(page.locator('#root')).toBeEmpty();
      const absent = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
      assert.equal(absent.active, 0);
      assert.equal(absent.releases, before.releases + 1);
      for (const key of [
        'sessions',
        'sessionSubscriptions',
        'sessionReleases',
        'sessionActive',
        'sessionDisposals',
        'parsers',
        'updates',
        'parserDisposals',
        'ownerDisposals',
      ])
        assert.equal(absent[key], before[key], key);
      assert.deepEqual(
        await page.evaluate(() => window.nativeViewProof.compare('mounted')),
        {
          snapshot: true,
          markdown: true,
          reasoning: true,
          owner: true,
          tripSummaries: true,
        }
      );
      // A successfully delivered response after unmount proves transport survived.
      backend.steps[5].releaseHeaders();
      await expect
        .poll(() => page.evaluate(() => window.nativeViewProof.inspect().texts))
        .toContain('# Updated while absent');
      const updated = await page.evaluate(() => {
        window.nativeViewProof.mark('absent');
        return window.nativeViewProof.inspect();
      });
      assert.ok(
        updated.reasoning.includes('**Reasoning updated while absent**')
      );
      assert.ok(
        updated.parsers + updated.updates > absent.parsers + absent.updates
      );
      assert.equal(
        await page.evaluate(
          () => window.nativeViewProof.compare('mounted').tripSummaries
        ),
        true
      );
      await page.evaluate(() => window.nativeViewProof.mount());
      await expect(
        page.getByRole('heading', { name: 'Updated while absent' })
      ).toBeVisible();
      if (retained.framework === 'react') {
        await expect(
          page.getByRole('region', { name: 'Reasoning' }).last()
        ).toHaveText('Reasoning updated while absent');
        await expect(
          page.getByRole('button', { name: 'Thinking…' })
        ).toHaveAttribute('aria-expanded', 'true');
      }
      await expect(
        page.getByRole('region', { name: 'Trip summary', exact: true })
      ).toHaveCount(2);
      const remounted = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
      assert.equal(remounted.active, 1);
      for (const key of [
        'sessions',
        'sessionSubscriptions',
        'sessionReleases',
        'sessionActive',
        'sessionDisposals',
        'parsers',
        'updates',
        'parserDisposals',
        'ownerDisposals',
      ])
        assert.equal(remounted[key], updated[key], key);
      assert.deepEqual(
        await page.evaluate(() => window.nativeViewProof.compare('absent')),
        {
          snapshot: true,
          markdown: true,
          reasoning: true,
          owner: true,
          tripSummaries: true,
        }
      );
      await page.evaluate(() => window.nativeViewProof.dispose());
      await physicallyClosed(backend.steps[5]);
      const disposed = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
      assert.equal(disposed.ownerDisposals, 1);
      assert.equal(disposed.sessionDisposals, 1);
      assert.equal(disposed.sessionActive, 0);
      assert.ok(disposed.parserDisposals > remounted.parserDisposals);
      assert.equal(
        backend.requests.filter((request) => request.path.endsWith('/state'))
          .length,
        1
      );
      return {
        before,
        absent,
        updated,
        remounted,
        disposed,
        physicalCloseBeforeCleanup: true,
        tripSummaryIdentity: true,
        terminalWriteCount: 1,
        exactRequestCount: 6,
        [retained.framework === 'angular'
          ? 'actualAngularComponentDestroy'
          : 'actualCreateRootUnmount']: true,
      };
    }
  );
}

export async function runProductionProofs(browser, retained) {
  const results = [];
  results.push(
    await scenario(
      browser,
      retained,
      'deep link, reload, Back and Forward',
      [
        ...initial(),
        ...initial(),
        lookup('b'),
        history('b'),
        lookup('a'),
        history('a'),
        lookup('b'),
        history('b'),
      ],
      async ({ page, expect, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        const icon = page.locator('link[rel="icon"]');
        await expect(icon).toHaveCount(1);
        await expect(icon).toHaveAttribute('type', 'image/svg+xml');
        const href = await icon.getAttribute('href');
        assert.match(href, /^data:image\/svg\+xml,/);
        assert.ok(retained.readOutput('index.html').toString().includes(href));
        const decoded = await page.evaluate(async (source) => {
          const response = await fetch(source);
          const svg = new DOMParser().parseFromString(
            await response.text(),
            'image/svg+xml'
          );
          const image = new Image();
          image.src = source;
          await image.decode();
          return {
            type: response.headers.get('content-type'),
            root: svg.documentElement.localName,
            errors: svg.querySelectorAll('parsererror').length,
            rendered: image.naturalWidth > 0 && image.naturalHeight > 0,
          };
        }, href);
        assert.deepEqual(decoded, {
          type: 'image/svg+xml',
          root: 'svg',
          errors: 0,
          rendered: true,
        });
        assert.equal(
          await page.evaluate(() => 'nativeViewProof' in window),
          false
        );
        await page.reload();
        await ready(page, expect);
        await select(page, 'a');
        await select(page, 'b');
        await ready(page, expect);
        await page.goBack();
        await expect(page).toHaveURL(/thread=a$/);
        await ready(page, expect);
        await page.goForward();
        await expect(page).toHaveURL(/thread=b$/);
        await ready(page, expect);
        return {
          realBrowserHistory: true,
          sameSelectionDoesNotRequest: true,
          favicon: decoded,
        };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'bare and query-only browser navigation',
      [search(), lookup('a'), history('a'), lookup('a'), history('a')],
      async ({ page, expect, url }) => {
        await page.goto(url);
        await select(page, 'a');
        await ready(page, expect);
        await page.evaluate(() =>
          history.pushState(null, '', '?thread=a&panel=details')
        );
        await page.goBack();
        await ready(page, expect);
        await page.goBack();
        await expect(
          page.getByText('Select a conversation or start a new one.')
        ).toBeVisible();
        await page.goForward();
        await ready(page, expect);
        return { queryOnlyHistoryEntry: true, realBackForward: true };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'history failure and Retry admission',
      [
        search(rows, { concurrentGroup: 'initial' }),
        lookup('a', { concurrentGroup: 'initial' }),
        history('a', '', { status: 503 }),
        lookup('a'),
        history('a'),
      ],
      async ({ page, expect, url }) => {
        await page.goto(url + '/?thread=a');
        await expect(
          page.getByText('Could not load this conversation.')
        ).toBeVisible();
        await expect(
          page.getByRole('textbox', { name: 'Message', exact: true })
        ).toBeDisabled();
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await ready(page, expect);
        await select(page, 'a');
      }
    )
  );
  for (const phase of ['lookup', 'history']) {
    const steps =
      phase === 'lookup'
        ? [
            search(),
            lookup('a', { holdHeaders: true }),
            lookup('b', { holdHeaders: true }),
            lookup('a'),
            history('a'),
          ]
        : [
            search(),
            lookup('a'),
            history('a', 'Old A', { holdBody: true }),
            lookup('b'),
            history('b', 'Old B', { holdBody: true }),
            lookup('a'),
            history('a'),
          ];
    results.push(
      await scenario(
        browser,
        retained,
        `A-B-A ${phase} race`,
        steps,
        async ({ page, expect, backend, url }) => {
          await page.goto(url);
          await select(page, 'a');
          const oldA = backend.steps[phase === 'lookup' ? 1 : 2],
            oldB = backend.steps[phase === 'lookup' ? 2 : 4];
          await deadline(oldA.received, 'A request');
          if (phase === 'history')
            await deadline(oldA.headersSent, 'A headers');
          await select(page, 'b');
          await physicallyClosed(oldA);
          await deadline(oldB.received, 'B request');
          if (phase === 'history')
            await deadline(oldB.headersSent, 'B headers');
          await select(page, 'a');
          await physicallyClosed(oldB);
          await ready(page, expect);
          oldA.releaseHeaders();
          oldA.releaseBody();
          oldB.releaseHeaders();
          oldB.releaseBody();
          await expect(
            page.getByText('Saved A', { exact: true })
          ).toBeVisible();
          return {
            physicalCloseBeforeCleanup: ['old A', 'old B'],
            lateServerReleaseIgnored: true,
          };
        }
      )
    );
  }
  results.push(
    await scenario(
      browser,
      retained,
      'A-B-A stream race',
      [
        ...initial(),
        run('a', 'Continue.', [values('Old streaming A')], { holdBody: true }),
        lookup('b'),
        history('b'),
        lookup('a'),
        history('a'),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        await submit(page, 'Continue.');
        await expect(
          page.getByText('Old streaming A', { exact: true })
        ).toBeVisible();
        await select(page, 'b');
        await physicallyClosed(backend.steps[3]);
        await ready(page, expect);
        await select(page, 'a');
        await ready(page, expect);
        backend.steps[3].releaseBody();
        await expect(page.getByText('Saved A', { exact: true })).toBeVisible();
        await expect(
          page.getByText('Old streaming A', { exact: true })
        ).toHaveCount(0);
        return { physicalCloseBeforeCleanup: true };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'list refresh during selection and creation ambiguity',
      [
        ...initial(),
        search([row('b')], { holdHeaders: true }),
        lookup('b'),
        history('b'),
        create({ holdHeaders: true }),
        lookup('a'),
        history('a'),
        search([row('a'), row('b'), row('new')]),
        create({ status: 503 }),
        search(),
        create(),
        lookup('new'),
        history('new'),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        await page
          .getByRole('button', { name: 'Refresh', exact: true })
          .click();
        await deadline(backend.steps[3].received, 'refresh');
        await expect(
          page.getByRole('button', { name: 'Refresh', exact: true })
        ).toBeDisabled();
        await select(page, 'b');
        await ready(page, expect);
        backend.steps[3].releaseHeaders();
        await expect(
          page.getByRole('button', { name: 'Conversation A', exact: true })
        ).toHaveCount(0);
        await expect(page.getByText('Saved B', { exact: true })).toBeVisible();
        await page.getByRole('button', { name: 'New', exact: true }).click();
        await deadline(backend.steps[6].received, 'creation');
        await expect(
          page.getByRole('button', { name: 'New', exact: true })
        ).toBeDisabled();
        await page.goBack();
        await physicallyClosed(backend.steps[6]);
        await ready(page, expect);
        backend.steps[6].releaseHeaders();
        await expect(
          page.getByText(/Creation could not be confirmed/)
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Refresh', exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Conversation NEW', exact: true })
        ).toBeVisible();
        await page.getByRole('button', { name: 'New', exact: true }).click();
        await expect(
          page.getByText(/Creation could not be confirmed/)
        ).toBeVisible();
        await page
          .getByRole('button', { name: 'Refresh', exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: 'Refresh', exact: true })
        ).toBeEnabled();
        await page.getByRole('button', { name: 'New', exact: true }).click();
        await expect(page).toHaveURL(/thread=new$/);
        await ready(page, expect);
        return {
          pendingCommandsDisabled: true,
          lateCreationTransportClosedBeforeCleanup: true,
          refreshCanRevealAmbiguousCreation: true,
        };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'duplicate submit guard, Stop and canonical correction',
      [
        ...initial(),
        run('a', '  Exact text\nSecond line.  ', [values('Partial answer')], {
          holdBody: true,
        }),
        run('a', 'Correct it.', [
          values('Draft obsolete words'),
          values('# Canonical answer\n\n- Corrected item'),
        ]),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        await submit(page, '  Exact text\nSecond line.  ');
        await expect(
          page.getByRole('button', { name: 'Stop', exact: true })
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Send', exact: true })
        ).toBeDisabled();
        await expect(
          page.getByRole('textbox', { name: 'Message', exact: true })
        ).toBeDisabled();
        await page.keyboard.press('Control+Enter');
        await page.keyboard.press('Control+Enter');
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await physicallyClosed(backend.steps[3]);
        await expect(
          page.getByText(
            'Response stopped locally. The server may still be running.',
            { exact: true }
          )
        ).toBeVisible();
        await submit(page, 'Correct it.');
        await expect(
          page.getByText('Response complete.', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('heading', { name: 'Canonical answer' })
        ).toBeVisible();
        await expect(
          page.getByRole('listitem').filter({ hasText: /^Corrected item$/ })
        ).toBeVisible();
        await expect(
          page.getByText('Draft obsolete words', { exact: true })
        ).toHaveCount(0);
        return {
          stopPhysicalCloseBeforeCleanup: true,
          exactRequestCount: 5,
          realNativeMarkdownCorrection: true,
        };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'canonical approval, repeated pause, preserved draft and uncertain Stop',
      [
        search(rows, { concurrentGroup: 'initial' }),
        lookup('a', { concurrentGroup: 'initial' }),
        approvalHistory('a'),
        resume(
          'a',
          'approved',
          [
            {
              event: 'updates',
              data: {
                __interrupt__: [approvalInterrupt('Review this next request.')],
              },
            },
          ],
          { holdBody: true }
        ),
        resume('a', 'denied', [values('Decision response complete.')]),
        lookup('b'),
        approvalHistory('b'),
        resume(
          'b',
          'approved',
          [
            {
              event: 'updates',
              data: {
                __interrupt__: [
                  approvalInterrupt('Request observed before Stop.'),
                ],
              },
            },
          ],
          { holdBody: true }
        ),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        const region = page.getByRole('region', {
          name: 'Approval request',
          exact: true,
        });
        const draft = page.getByRole('textbox', {
          name: 'Message',
          exact: true,
        });
        const approve = page.getByRole('button', {
          name: 'Approve request',
          exact: true,
        });
        const decline = page.getByRole('button', {
          name: 'Decline request',
          exact: true,
        });
        const send = page.getByRole('button', { name: 'Send', exact: true });
        const stop = page.getByRole('button', { name: 'Stop', exact: true });
        const text = '  Keep this next-message draft.\nExactly as written.  ';
        await expect(region).toBeVisible();
        if (retained.framework === 'react')
          await expect(region).toHaveClass(/tp-approval-card/);
        assert.equal(
          await region.locator('.approval-reason').textContent(),
          approvalReason
        );
        await expect(region.locator('img, script')).toHaveCount(0);
        await expect(approve).toBeEnabled();
        await expect(decline).toBeEnabled();
        await draft.fill(text);
        await draft.press('Control+Enter');
        await draft.press('Meta+Enter');
        await expect(draft).toHaveValue(text);
        await expect(send).toBeDisabled();
        assert.equal(backend.requests.length, 3);
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        );
        await approve.focus();
        await expect(approve).toBeFocused();
        assert.notEqual(
          await approve.evaluate(
            (button) => getComputedStyle(button).outlineStyle
          ),
          'none'
        );
        await approve.press('Enter');
        await deadline(backend.steps[3].received, 'held approval request');
        // Replacement evidence can arrive before the operation promise settles.
        await expect(region.locator('.approval-reason')).toHaveText(
          'Review this next request.'
        );
        await expect(
          page.getByText('Sending decision…', { exact: true })
        ).toBeVisible();
        await expect(approve).toBeDisabled();
        await expect(decline).toBeDisabled();
        await expect(send).toBeDisabled();
        await expect(draft).toBeDisabled();
        await expect(draft).toHaveValue(text);
        await expect(stop).toBeEnabled();
        await page.keyboard.press('Enter');
        await page.keyboard.press('Control+Enter');
        assert.equal(backend.requests.length, 4);
        backend.steps[3].releaseBody();
        await expect(decline).toBeEnabled();
        await expect(draft).toBeEnabled();
        await expect(draft).toHaveValue(text);
        await expect(send).toBeDisabled();
        await decline.focus();
        await decline.press('Space');
        await expect(
          page.getByText('Decision response complete.', { exact: true }).last()
        ).toBeVisible();
        await expect(region).toHaveCount(0);
        await expect(send).toBeEnabled();
        await expect(draft).toHaveValue(text);
        await expect(
          page.getByRole('article', { name: 'user message', exact: true })
        ).toHaveCount(0);
        assert.equal(backend.requests.length, 5);
        await select(page, 'b');
        await expect(page.locator('.conversation-id')).toHaveText(
          'Conversation ID: b'
        );
        await expect(approve).toBeEnabled();
        await expect(draft).toHaveValue('');
        await draft.fill('Preserve this while the decision is uncertain.');
        await approve.click();
        await expect(region.locator('.approval-reason')).toHaveText(
          'Request observed before Stop.'
        );
        await expect(approve).toBeDisabled();
        await stop.click();
        await physicallyClosed(backend.steps[7]);
        await expect(
          page.getByText(
            'Decision completion could not be confirmed. The server may still be running.',
            { exact: true }
          )
        ).toBeVisible();
        await expect(stop).toHaveCount(0);
        await expect(approve).toBeDisabled();
        await expect(decline).toBeDisabled();
        await expect(send).toBeDisabled();
        await expect(draft).toBeEnabled();
        await expect(draft).toHaveValue(
          'Preserve this while the decision is uncertain.'
        );
        await draft.press('Control+Enter');
        await expect(page.getByRole('button', { name: /retry/i })).toHaveCount(
          0
        );
        assert.equal(backend.requests.length, 8);
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          true
        );
        return {
          exactRequestCount: 8,
          literalReason: true,
          keyboardDecisions: true,
          draftPreserved: true,
          repeatPauseAfterSettlement: true,
          physicalCloseBeforeCleanup: true,
          uncertainPauseNotActionable: true,
          mobileOverflow: false,
        };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'supplied trip summaries, terminal persistence and observational reload',
      [
        ...initial(),
        run('a', 'Show the supplied recap.', [summaryEvent, summaryEvent]),
        summaryWrite({ holdBody: true }),
        run('a', 'Continue explicitly.', [
          {
            event: 'messages',
            data: [
              {
                type: 'AIMessageChunk',
                id: 'next-explicit-answer',
                content: 'Next explicit response.',
              },
              {},
            ],
          },
          { event: 'messages/complete', data: [] },
        ]),
        search(rows, { concurrentGroup: 'reload' }),
        lookup('a', { concurrentGroup: 'reload' }),
        summaryHistory(),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        await submit(page, 'Show the supplied recap.');
        await deadline(backend.steps[4].received, 'terminal summary write');
        const cards = page.getByRole('region', {
          name: 'Trip summary',
          exact: true,
        });
        await expect(cards).toHaveCount(2);
        const mountedCard = await cards.first().elementHandle();
        assert.ok(mountedCard);
        await expect(
          cards.first().getByRole('heading', { level: 4 })
        ).toHaveText(summaryTitle);
        await expect(cards.first().locator('.trip-summary-counts')).toHaveText(
          '2 days · 2 stops'
        );
        await expect(cards.first().locator('.trip-summary-day')).toHaveCount(2);
        await expect(
          cards.first().getByRole('heading', { level: 5 })
        ).toHaveText(['Day 1', 'Day 1']);
        await expect(cards.first().locator('.trip-summary-place')).toHaveText([
          summaryPlace,
          summaryPlace,
        ]);
        await expect(
          cards.first().getByText('No stops', { exact: true })
        ).toBeVisible();
        await expect(cards.first().locator('.trip-summary-note')).toHaveText(
          summaryNote
        );
        await expect(cards.last().locator('.trip-summary-counts')).toHaveText(
          '0 days · 0 stops'
        );
        await expect(
          cards.last().getByText('No days supplied.', { exact: true })
        ).toBeVisible();
        await expect(cards.locator('img, script, b')).toHaveCount(0);
        await expect(
          page
            .getByRole('article', { name: 'assistant message', exact: true })
            .locator('.tool-observation')
        ).toHaveCount(0);
        await expect(
          page.getByText('Response in progress…', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('button', { name: 'Stop', exact: true })
        ).toBeEnabled();
        await expect(
          page.getByText('Response complete.', { exact: true })
        ).toHaveCount(0);
        assert.equal(backend.requests.length, 5);
        await page.setViewportSize({ width: 375, height: 812 });
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth
          ),
          false
        );
        backend.steps[4].releaseBody();
        await expect(
          page.getByText('Response complete.', { exact: true })
        ).toBeVisible();
        assert.equal(backend.requests.length, 5);
        await submit(page, 'Continue explicitly.');
        await expect(
          page.getByText('Next explicit response.', { exact: true }).last()
        ).toBeVisible();
        await ready(page, expect);
        assert.equal(backend.requests.length, 6);
        await expect(
          page.getByText('Response complete.', { exact: true })
        ).toBeVisible();
        await expect(cards).toHaveCount(2);
        assert.equal(await mountedCard.evaluate((el) => el.isConnected), true);
        await page.reload();
        await ready(page, expect);
        await expect(cards).toHaveCount(0);
        const toolRows = page.getByRole('article', {
          name: 'tool message',
          exact: true,
        });
        await expect(toolRows.locator('pre')).toHaveText(summaryTexts);
        await expect(toolRows.locator('img, script, b')).toHaveCount(0);
        assert.equal(backend.requests.length, 9);
        return {
          exactRequestCount: 9,
          exactTerminalPersistence: true,
          terminalNoAutoContinue: true,
          nextExplicitSubmit: true,
          cardsRetainedAfterNextTurn: true,
          mountedCardRetainedAfterNextTurn: true,
          pendingStatus: true,
          restorationNoReexecute: true,
          literalSummary: true,
          duplicateLabels: true,
          emptyLists: true,
          mobileOverflow: false,
        };
      }
    )
  );
  results.push(
    await scenario(
      browser,
      retained,
      'trip summary persistence failure remains an error without automatic retry',
      [
        ...initial(),
        run('a', 'Show the supplied recap.', [
          { event: 'values', data: { messages: [singleSummaryMessage] } },
        ]),
        summaryWrite({
          status: 503,
          payload: {
            values: {
              messages: [
                {
                  id: 'client-tool-result-summary-single',
                  role: 'tool',
                  type: 'tool',
                  tool_call_id: 'summary-single',
                  content: 'One supplied day\nDay 2: Museum',
                },
              ],
            },
          },
        }),
        search(rows, { concurrentGroup: 'reload' }),
        lookup('a', { concurrentGroup: 'reload' }),
        summaryHistory(false, singleSummaryMessage),
      ],
      async ({ page, expect, backend, url }) => {
        await page.goto(url + '/?thread=a');
        await ready(page, expect);
        await submit(page, 'Show the supplied recap.');
        await expect(
          page.getByText('The response failed.', { exact: true })
        ).toBeVisible();
        await expect(
          page.getByRole('region', { name: 'Trip summary', exact: true })
        ).toHaveCount(1);
        await expect(page.locator('.trip-summary-counts')).toHaveText(
          '1 day · 1 stop'
        );
        await expect(
          page.getByText('Response complete.', { exact: true })
        ).toHaveCount(0);
        assert.equal(backend.requests.length, 5);
        await page.reload();
        await ready(page, expect);
        await expect(
          page.getByRole('region', { name: 'Trip summary', exact: true })
        ).toHaveCount(0);
        await expect(
          page.getByRole('article', { name: 'tool message', exact: true })
        ).toHaveCount(0);
        await expect(page.locator('.tool-observation .muted')).toHaveText(
          'Observed tool status: pending'
        );
        assert.equal(backend.requests.length, 8);
        return {
          exactRequestCount: 8,
          errorStatus: true,
          oneWriteAttempt: true,
          noAutomaticRetry: true,
          restorationNoReexecute: true,
        };
      }
    )
  );
  return results;
}

export async function runBrowserProofs(directory) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const app = readRetainedBuild(join(directory, 'app'));
    const authored = file(
      directory,
      'app/source/examples/chat/native/' +
        (app.framework === 'angular'
          ? 'angular/src/index.html'
          : 'react/index.html')
    ).toString();
    const icon = authored.match(
      /<link\s+rel="icon"\s+type="image\/svg\+xml"\s+href="([^"]+)"\s*\/>/
    );
    assert.ok(icon, 'Authored application must declare its favicon');
    assert.ok(
      app.readOutput('index.html').toString().includes(icon[1]),
      'Built favicon must preserve the exact authored data URI'
    );
    const production = await runProductionProofs(browser, app);
    const checkedView = readViewProof(join(directory, 'view-proof'));
    assert.equal(
      checkedView.framework,
      app.framework,
      'App/view framework mismatch'
    );
    const view = await runViewProof(browser, checkedView);
    return {
      framework: app.framework,
      production,
      view,
      coverage: {
        installedOwnerTests:
          'Exhaustive synchronous command reentry and delayed actual SDK promise completion matrix. Browser cases cover user-reachable controls and physical HTTP cancellation.',
        limitation:
          'No claim of actual browser BFCache; browser history uses real Back/Forward, with a deliberately seeded query-only history entry.',
      },
    };
  } finally {
    await browser.close();
  }
}

export async function startReview(retained) {
  const backend = await startProofServer([
    search(),
    lookup('a'),
    history(
      'a',
      '# Saved conversation\n\n- Restored Markdown\n\n| Item | Status |\n| --- | --- |\n| Proof | Ready |'
    ),
    run('a', 'Show the proof.', [
      values(
        '# Verified response\n\nThe production application uses the actual installed runtime.'
      ),
    ]),
    search(),
    lookup('b'),
    history('b'),
  ]);
  let server;
  try {
    server = await startCheckedServer({
      retained: retained.app,
      target: backend.origin + '/api',
    });
  } catch (error) {
    await backend.close();
    throw error;
  }
  return {
    url: server.url,
    instructions:
      'Open this URL once. Select Conversation A; inspect the heading, list and table. Enter exactly “Show the proof.” and Send. Inspect Verified response. Click Refresh, then Conversation B and wait for Saved B. Stop this process to print the exact fixture verification result. Use a new --review process for another browser walkthrough.',
    async close() {
      let verified = false;
      try {
        backend.verify();
        verified = true;
      } catch {
        /* An intentionally partial walkthrough is allowed. */
      }
      await server.close();
      await backend.close();
      return {
        verified,
        received: backend.requests.length,
        expected: backend.steps.length,
      };
    },
  };
}
