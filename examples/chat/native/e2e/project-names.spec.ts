import { expect, test } from '@playwright/test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('installed React project creation and renaming persist locally without conversation commands', async ({
  page,
}, testInfo) => {
  test.setTimeout(300_000);
  const { buildConsumer } = await import('../tooling/consumer.mjs');
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { captureRetainedBuild, readRetainedBuild, startCheckedServer } =
    await import('../tooling/retained-build.mjs');
  const work = realpathSync(
    mkdtempSync(join(tmpdir(), 'native-project-names-'))
  );
  const row = {
    ...threadEnvelope('a', 'Alpha notes'),
    metadata: { title: 'Alpha notes', projectId: 'project-a' },
  };
  const initial = () => [
    {
      method: 'POST',
      path: '/api/threads/search',
      payload: { limit: 50, offset: 0 },
      body: [row],
    },
    { method: 'GET', path: '/api/threads/a', body: row },
    {
      method: 'POST',
      path: '/api/threads/a/history',
      payload: { limit: 10 },
      body: [],
    },
  ];
  const backend = await startProofServer([...initial(), ...initial()]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const importedName = '<Imported project> ' + 'W'.repeat(160);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    await buildConsumer({
      root: resolve('.'),
      assistantId: 'assistant',
      output: join(work, 'production'),
      capture: (context) =>
        captureRetainedBuild(join(work, 'retained'), context),
    });
    server = await startCheckedServer({
      retained: readRetainedBuild(join(work, 'retained')),
      target: backend.origin + '/api',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin)
        return route.continue();
      errors.push('Unexpected external request');
      return route.abort();
    });
    await page.addInitScript(() => {
      const state = { fail: false };
      Object.assign(window, { projectStorageProof: state });
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === 'threadplane-native-react-projects-v1' && state.fail)
          throw new DOMException('quota', 'QuotaExceededError');
        return original.call(this, key, value);
      };
      Object.defineProperty(crypto, 'randomUUID', {
        configurable: true,
        value: () => '00000000-0000-4000-8000-000000000001',
      });
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    await draft.fill('Keep this project draft.');
    const draftNode = await draft.elementHandle();
    await nav.getByRole('button', { name: 'New project', exact: true }).click();
    const editor = page.getByRole('textbox', {
      name: 'Project name',
      exact: true,
    });
    await editor.fill('  <Local project>  ');
    await page.evaluate(() => {
      (
        window as unknown as { projectStorageProof: { fail: boolean } }
      ).projectStorageProof.fail = true;
    });
    await nav.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(editor).toHaveValue('  <Local project>  ');
    await expect(
      nav.getByRole('button', { name: 'Create', exact: true })
    ).toBeDisabled();
    expect(backend.requests).toHaveLength(3);
    await page.evaluate(() => {
      (
        window as unknown as { projectStorageProof: { fail: boolean } }
      ).projectStorageProof.fail = false;
    });
    await nav
      .getByRole('button', { name: 'Retry project storage', exact: true })
      .click();
    await expect(editor).toHaveValue('  <Local project>  ');
    await nav.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(
      nav.getByText('Project created in this browser.', { exact: true })
    ).toBeVisible();
    await expect(
      nav.getByRole('button', { name: '<Local project>', exact: true })
    ).toHaveAttribute('aria-current', 'true');
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await expect(draft).toHaveValue('Keep this project draft.');
    expect(
      await draftNode?.evaluate(
        (node) => node === document.querySelector('#message')
      )
    ).toBe(true);
    expect(backend.requests).toHaveLength(3);
    await nav
      .getByRole('button', {
        name: 'Rename project <Local project> (00000000-0000-4000-8000-000000000001)',
        exact: true,
      })
      .click();
    await editor.fill('Discard this');
    await editor.press('Escape');
    await expect(
      nav.getByRole('button', { name: '<Local project>', exact: true })
    ).toBeVisible();
    await nav
      .getByRole('button', {
        name: 'Rename project <Local project> (00000000-0000-4000-8000-000000000001)',
        exact: true,
      })
      .click();
    await editor.fill('<Renamed project>');
    await nav.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      nav.getByRole('button', { name: '<Renamed project>', exact: true })
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('project-names-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole('button', { name: 'Open conversations', exact: true })
      .click();
    await nav
      .getByRole('button', {
        name: 'Rename project project-a (project-a)',
        exact: true,
      })
      .click();
    await editor.fill(importedName);
    expect(
      await editor.evaluate(
        (node) => node.getBoundingClientRect().right <= innerWidth
      )
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('project-names-mobile.png'),
      fullPage: true,
    });
    await nav.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      nav.getByRole('button', { name: importedName, exact: true })
    ).toBeVisible();
    await nav
      .getByRole('button', {
        name: `Rename project ${importedName} (project-a)`,
        exact: true,
      })
      .click();
    expect(
      await nav
        .locator('.native-projects')
        .evaluate((node) => node.scrollWidth <= node.clientWidth)
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath('project-names-long-mobile.png'),
      fullPage: true,
    });
    await editor.press('Escape');
    await expect(draft).toHaveValue('Keep this project draft.');
    expect(backend.requests).toHaveLength(3);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.reload();
    await expect(
      page.getByRole('heading', { name: 'Alpha notes', exact: true })
    ).toBeVisible();
    await expect(
      nav.getByRole('button', { name: '<Renamed project>', exact: true })
    ).toBeVisible();
    await expect(
      nav.getByRole('button', { name: importedName, exact: true })
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          JSON.parse(
            localStorage.getItem(
              'threadplane-native-react-projects-v1'
            ) as string
          ).projects
      )
    ).toEqual([
      { id: '00000000-0000-4000-8000-000000000001', name: '<Renamed project>' },
      { id: 'project-a', name: importedName },
    ]);
    expect(backend.requests).toHaveLength(6);
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
    rmSync(work, { recursive: true, force: true });
  }
});
