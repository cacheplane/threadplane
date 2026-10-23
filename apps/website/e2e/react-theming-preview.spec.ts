import { test, expect, type Page } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fromPageOrReactPreview } from './fixtures/react-preview-requests';

const origin = 'http://127.0.0.1:4644';
const route = '/docs/chat/guides/theming';
const frameURL = /(?:localhost:4644|chat\/theming\/react)/;
const observations = new WeakMap<
  Page,
  {
    errors: string[];
    requests: { method: string; url: string; body: string | null }[];
  }
>();

async function mode(page: Page, name: 'Docs' | 'Code' | 'Run', width: number) {
  if (width === 390) {
    await page
      .getByRole('button', { name: 'Open navigation', exact: true })
      .click();
    await page
      .getByRole('dialog')
      .getByRole('button', {
        name: name === 'Run' ? /^Run(?:,|$)/ : name,
        exact: name !== 'Run',
      })
      .click();
    await expect(page.getByRole('dialog')).toBeHidden();
  } else
    await page
      .locator('[data-workspace-desktop-navigation]')
      .getByRole('button', {
        name: name === 'Run' ? /^Run(?:,|$)/ : name,
        exact: name !== 'Run',
      })
      .click();
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-workspace-mode',
    name
  );
}

test.describe('native Theming Website', () => {
  test.describe.configure({ mode: 'serial' });
  test.skip(
    !!process.env['BASE_URL'],
    'Compiled graph controls and deterministic providers are local only.'
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
  });
  test.afterEach(async ({ page, request }, info) => {
    await writeFile(info.outputPath('page.html'), await page.content());
    await writeFile(
      info.outputPath('browser-observations.json'),
      JSON.stringify(observations.get(page), null, 2)
    );
    await page.goto('about:blank');
    await expect
      .poll(
        async () =>
          (
            await (await request.get(origin + '/__lifetime')).json()
          ).active
      )
      .toEqual({ children: 0, streams: 0, histories: 0, handlers: 0 });
    await expect
      .poll(
        async () =>
          (
            await (await request.get(origin + '/__lifetime')).json()
          ).responseOpen
      )
      .toBe(0);
    const lifetime = await (await request.get(origin + '/__lifetime')).json();
    for (const child of lifetime.children) {
      expect(child.reaped).toBe(true);
      expect(() => process.kill(child.pid, 0)).toThrow(/ESRCH/);
      expect(() => process.kill(-child.pgid, 0)).toThrow(/ESRCH/);
    }
    await writeFile(
      info.outputPath('observed-child-absence.json'),
      JSON.stringify(
        { children: lifetime.children, observedPidAndPgidAbsence: 'ESRCH' },
        null,
        2
      )
    );
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
      expect((await page.goto(route + '?frontend=react'))?.status()).toBe(200);
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
      await mode(page, 'Code', width);
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
      await mode(page, 'Run', width);
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
        await mode(page, name, width);
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
      const captures = await (await request.get(origin + '/__captures')).json();
      expect(captures).toHaveLength(1);
      const { threadId, runId } = captures[0];
      expect(wire[0].body).toMatchObject({
        thread_id: threadId,
        if_exists: 'raise',
      });
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
      expect(captures[0].sseSha256).toBe(
        createHash('sha256').update(captures[0].sse).digest('hex')
      );
      expect(captures[0].historyResponses).toHaveLength(1);
      expect(captures[0].historyResponses[0]).toHaveLength(1);
      expect(captures[0].historyResponses[0][0]).toMatchObject({
        values: { messages: captures[0].savedMessages },
        next: [],
        checkpoint: { thread_id: threadId, checkpoint_ns: '' },
      });
      expect(captures[0].proof).toMatchObject({
        actualCompiledGraph: true,
        networkConnectAttempts: 0,
        titleMessageCallbacks: 0,
      });
      expect(captures[0].titleUpdates).toHaveLength(1);
      expect(captures[0].sse).not.toContain('Authored metadata title');
      expect(
        captures[0].savedMessages.find(
          (m: { type: string }) => m.type === 'human'
        ).content
      ).toBe('Explain lift ✈ café');
      expect(
        captures[0].savedMessages.filter(
          (m: { type: string }) => m.type === 'ai'
        )
      ).toHaveLength(1);
      const before = [...(observations.get(page)?.requests ?? [])];
      await frame
        .getByLabel('Message', { exact: true })
        .fill('Retained follow-up draft');
      for (const name of ['Light', 'Ocean', 'Forest', 'Dark'])
        await frame.getByRole('button', { name, exact: true }).click();
      for (const name of ['Code', 'Docs', 'Run'] as const)
        await mode(page, name, width);
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
    await expect(page.getByLabel('Example UI')).toHaveValue('angular');
    await expect(
      page.getByRole('heading', {
        name: 'React chat theming preview',
        exact: true,
      })
    ).toHaveCount(0);
    await page.getByLabel('Example UI').selectOption('react');
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
