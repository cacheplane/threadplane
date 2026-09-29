import assert from 'node:assert/strict';
import { join } from 'node:path';
import { startProofServer, threadEnvelope } from './proof-server.mjs';
import {
  file,
  readRetainedBuild,
  startCheckedServer,
} from './retained-build.mjs';
import { readViewProof } from './view-proof.mjs';

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
      input: { messages: [{ type: 'human', id: messageId, content: text }] },
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
  let server, context;
  const errors = [],
    consoleErrors = [],
    failures = [];
  try {
    server = await startCheckedServer({
      retained,
      target: backend.origin + '/api',
    });
    context = await browser.newContext();
    const page = await context.newPage();
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
  } finally {
    await context?.close();
    await server?.close();
    await backend.close();
  }
}

const ready = async (page, expect) =>
  expect(
    page.getByRole('textbox', { name: 'Message', exact: true })
  ).toBeEnabled();
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
    'actual React unmount/remount and explicit owner disposal',
    [
      ...initial(),
      run(
        'a',
        'Keep working while the view is absent.',
        [values('# Updated while absent')],
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
      await submit(page, 'Keep working while the view is absent.');
      await deadline(backend.steps[3].received, 'held view request');
      await page.evaluate(() => window.nativeViewProof.mark('mounted'));
      const before = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
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
        { snapshot: true, markdown: true, owner: true }
      );
      // A successfully delivered response after unmount proves transport survived.
      backend.steps[3].releaseHeaders();
      await expect
        .poll(() => page.evaluate(() => window.nativeViewProof.inspect().texts))
        .toContain('# Updated while absent');
      const updated = await page.evaluate(() => {
        window.nativeViewProof.mark('absent');
        return window.nativeViewProof.inspect();
      });
      assert.ok(
        updated.parsers + updated.updates > absent.parsers + absent.updates
      );
      await page.evaluate(() => window.nativeViewProof.mount());
      await expect(
        page.getByRole('heading', { name: 'Updated while absent' })
      ).toBeVisible();
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
        { snapshot: true, markdown: true, owner: true }
      );
      await page.evaluate(() => window.nativeViewProof.dispose());
      await physicallyClosed(backend.steps[3]);
      const disposed = await page.evaluate(() =>
        window.nativeViewProof.inspect()
      );
      assert.equal(disposed.ownerDisposals, 1);
      assert.equal(disposed.sessionDisposals, 1);
      assert.equal(disposed.sessionActive, 0);
      assert.ok(disposed.parserDisposals > remounted.parserDisposals);
      return {
        before,
        absent,
        updated,
        remounted,
        disposed,
        physicalCloseBeforeCleanup: true,
        actualCreateRootUnmount: true,
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
  return results;
}

export async function runBrowserProofs(directory) {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch();
  try {
    const app = readRetainedBuild(join(directory, 'app'));
    const authored = file(
      directory,
      'app/source/examples/chat/native/react/index.html'
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
    const view = await runViewProof(
      browser,
      readViewProof(join(directory, 'view-proof'))
    );
    return {
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
