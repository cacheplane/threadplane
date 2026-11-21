import { selectWorkspaceMode } from './fixtures/workspace-controls';
import { selectFramework } from './fixtures/framework-controls';
import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

// The preview's server (`serve.mjs chat-theming --backend`) runs the real
// graph under `langgraph dev` on aimock fixtures shared with the Angular
// example, and records requests through scripts/react-cockpit/langgraph-proxy.mjs.
const origin = 'http://127.0.0.1:4644';
const route = '/docs/angular/chat/guides/theming';
const reactRoute = '/docs/react/chat/guides/theming';
const frameURL = /(?:localhost:4644|chat\/theming\/react)/;
const observations = new WeakMap<
  Page,
  {
    errors: string[];
    requests: { method: string; url: string; body: string | null }[];
  }
>();

async function mode(page: Page, name: 'Docs' | 'Code' | 'Run') {
  await selectWorkspaceMode(page, name);
}

test.describe('native Theming Website', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !!process.env['BASE_URL'],
    'The aimock-backed graph and its proxy controls are local only.'
  );
  test.beforeEach(async ({ page, request }) => {
    const observed = {
      errors: [] as string[],
      requests: [] as { method: string; url: string; body: string | null }[],
    };
    observations.set(page, observed);
    page.on('pageerror', (error) => observed.errors.push(error.message));
    page.on('request', (request) => {
      if (
        /\/threads(?:\/|$)/.test(new URL(request.url()).pathname) &&
        fromPageOrReactPreview(request, frameURL)
      )
        observed.requests.push({
          method: request.method(),
          url: request.url(),
          body: request.postData(),
        });
    });
    expect((await request.post(origin + '/__reset')).ok()).toBe(true);
    // The backend starts lazily; wait for it before measuring UI transitions.
    expect(
      (await request.post(origin + '/__ready', { timeout: 180000 })).ok()
    ).toBe(true);
  });
  test.afterEach(async ({ page, request }, info) => {
    await writeFile(info.outputPath('page.html'), await page.content());
    await writeFile(
      info.outputPath('browser-observations.json'),
      JSON.stringify(observations.get(page), null, 2)
    );
    // Every proxied browser connection closes and nothing stays held.
    await page.goto('about:blank');
    await expect
      .poll(async () => (await request.get(origin + '/__lifetime')).json())
      .toMatchObject({ activeStream: false, activeHistory: false, openResponses: 0 });
    for (const path of ['/__requests', '/__captures', '/__lifetime'])
      await writeFile(
        info.outputPath(path.slice(3) + '.json'),
        JSON.stringify(await (await request.get(origin + path)).json(), null, 2)
      );
    expect(observations.get(page)?.errors).toEqual([]);
  });

  for (const width of [1280, 390])
    test(`Docs Code Run preserves the themed owner and compiled graph at ${width}`, async ({
      page,
      request,
    }, info) => {
      test.setTimeout(90000);
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      expect((await page.goto(reactRoute))?.status()).toBe(200);
      await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
        'data-hydrated',
        'true',
        { timeout: 30000 }
      );
      await expect(
        page.getByRole('heading', {
          name: 'React chat theming preview',
          exact: true,
        })
      ).toBeVisible();
      await expect(
        page.locator(
          '[data-example-file="cockpit/chat/theming/react/src/styles.css"]'
        )
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath('docs.png'),
        fullPage: true,
      });
      await mode(page, 'Code');
      const files = [
        'app.tsx',
        'application.ts',
        'connection.ts',
        'themes.ts',
        'main.tsx',
        'styles.css',
        'project.json',
        'graph.py',
        'theming.md',
      ];
      if (width === 390) {
        for (const file of files)
          await expect(
            page
              .getByRole('tab')
              .filter({
                has: page.locator(
                  `[data-tab-close][aria-label="Close ${file}"]`
                ),
              })
          ).toHaveCount(1);
      } else {
        const tree = page.getByRole('complementary', { name: 'File tree' });
        for (const file of files)
          await expect(
            tree.getByRole('button', { name: file, exact: true })
          ).toBeVisible();
        await expect(tree).not.toContainText(
          /fixture|\.spec\.|wire\.py|tests\//
        );
      }
      await page.screenshot({ path: info.outputPath('code.png') });
      await mode(page, 'Run');
      const iframe = page.locator('iframe');
      await expect(iframe).toHaveAttribute('src', frameURL);
      const original = await iframe.elementHandle();
      const frame = page.frameLocator('iframe');
      await expect(frame.getByRole('status')).toHaveText('Ready.');
      const draft = 'Exact unsent aviation draft ✈ café';
      await frame.getByLabel('Message', { exact: true }).fill(draft);
      for (const name of ['Dark', 'Light', 'Ocean', 'Forest']) {
        await frame.getByRole('button', { name, exact: true }).click();
        await expect(
          frame.getByRole('button', { name, exact: true })
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(
          draft
        );
      }
      expect(await (await request.get(origin + '/__requests')).json()).toEqual(
        []
      );
      expect(observations.get(page)?.requests).toEqual([]);
      for (const name of ['Docs', 'Code', 'Run'] as const)
        await mode(page, name);
      expect(
        await iframe.evaluate((node, previous) => node === previous, original)
      ).toBe(true);
      await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(
        draft
      );
      await expect(
        frame.getByRole('button', { name: 'Forest', exact: true })
      ).toHaveAttribute('aria-pressed', 'true');
      expect(await (await request.get(origin + '/__requests')).json()).toEqual(
        []
      );
      expect(observations.get(page)?.requests).toEqual([]);
      await frame
        .getByLabel('Message', { exact: true })
        .fill('Explain lift ✈ café');
      await frame.getByRole('button', { name: 'Send', exact: true }).click();
      await expect(frame.getByRole('status')).toHaveText('Response saved.', {
        timeout: 20000,
      });
      const wire = await (await request.get(origin + '/__requests')).json();
      expect(wire).toHaveLength(4);
      expect(
        wire.map((r: { path: string; method: string }) =>
          r.path.endsWith('/stream')
            ? 'stream'
            : r.path.endsWith('/history')
            ? 'history'
            : r.method === 'GET'
            ? 'terminal-run-read'
            : 'create'
        )
      ).toEqual(['create', 'stream', 'terminal-run-read', 'history']);
      expect(wire.map((r: { method: string }) => r.method)).toEqual([
        'POST',
        'POST',
        'GET',
        'POST',
      ]);
      const captures: {
        sse: string;
        savedMessages: { type: string; content: string }[];
        next: string[];
        titleBefore: string | null;
        titleAfter: string | null;
      }[] = await (await request.get(origin + '/__captures')).json();
      expect(captures).toHaveLength(1);
      const threadId = wire[0].body.thread_id;
      const runId = wire[2].path.split('/').at(-1);
      expect(wire[0].body).toMatchObject({ if_exists: 'raise' });
      expect(wire.map((r: { path: string }) => r.path)).toEqual([
        '/api/threads',
        `/api/threads/${threadId}/runs/stream`,
        `/api/threads/${threadId}/runs/${runId}`,
        `/api/threads/${threadId}/history`,
      ]);
      expect(wire[1].body.assistant_id).toBe('c-theming');
      expect(wire[1].body.input.messages[0].content).toBe(
        'Explain lift ✈ café'
      );
      // The real server saved one finished turn with its title.
      expect(captures[0].next).toEqual([]);
      expect(captures[0].titleBefore).toBeNull();
      expect(captures[0].titleAfter).toBe('Aviation snippet title');
      expect(
        captures[0].savedMessages.find((m) => m.type === 'human')?.content
      ).toBe('Explain lift ✈ café');
      expect(
        captures[0].savedMessages.filter((m) => m.type === 'ai')
      ).toHaveLength(1);
      const before = [...(observations.get(page)?.requests ?? [])];
      await frame
        .getByLabel('Message', { exact: true })
        .fill('Retained follow-up draft');
      for (const name of ['Light', 'Ocean', 'Forest', 'Dark'])
        await frame.getByRole('button', { name, exact: true }).click();
      for (const name of ['Code', 'Docs', 'Run'] as const)
        await mode(page, name);
      expect(
        await iframe.evaluate((node, previous) => node === previous, original)
      ).toBe(true);
      await expect(frame.getByRole('status')).toHaveText('Response saved.');
      await expect(frame.getByLabel('Message', { exact: true })).toHaveValue(
        'Retained follow-up draft'
      );
      expect(await (await request.get(origin + '/__requests')).json()).toEqual(
        wire
      );
      expect(observations.get(page)?.requests).toEqual(before);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath('run.png'),
        fullPage: true,
      });
      const content = await iframe.contentFrame().locator('html').innerHTML();
      await writeFile(info.outputPath('frame.html'), content);
    });

  test('Angular remains the canonical default and React is explicitly selectable', async ({
    page,
    request,
  }) => {
    await page.goto(route);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true',
      { timeout: 30000 }
    );
    await expect(page.getByLabel('Framework')).toHaveAttribute('data-value', 'angular');
    await expect(
      page.getByRole('heading', {
        name: 'React chat theming preview',
        exact: true,
      })
    ).toHaveCount(0);
    await selectFramework(page, 'react');
    await expect(
      page.getByRole('heading', {
        name: 'React chat theming preview',
        exact: true,
      })
    ).toBeVisible();
    expect(await (await request.get(origin + '/__requests')).json()).toEqual(
      []
    );
  });
});
