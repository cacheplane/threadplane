import { test } from './fixtures';
import { expect } from '@playwright/test';
import assert from 'node:assert/strict';

test('installed React project menus retain conversation ownership through keyboard actions and narrow RTL', async ({
  page,
  retainedConsumer,
}, testInfo) => {
  const { startProofServer, threadEnvelope } = await import(
    '../tooling/proof-server.mjs'
  );
  const { startCheckedServer } = await import('../tooling/retained-build.mjs');
  const projectId = ' p/<one> ';
  const name = '<Project & one>';
  const otherId = '__proto__';
  const key = 'threadplane-native-react-projects-v1';
  const row = {
    ...threadEnvelope('a', 'Retained project conversation'),
    metadata: { title: 'Retained project conversation', projectId },
  };
  const backend = await startProofServer([
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
  ]);
  let server: Awaited<ReturnType<typeof startCheckedServer>> | undefined;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    server = await startCheckedServer({
      retained: retainedConsumer,
      target: backend.origin + '/api',
      apiKey: 'project-menu-proof-key',
    });
    const origin = server.url;
    await page.route('**/*', (route) => {
      if (new URL(route.request().url()).origin === origin) {
        expect(route.request().headers()['x-api-key']).toBeUndefined();
        return route.continue();
      }
      errors.push('Unexpected external request');
      return route.abort();
    });
    await page.addInitScript(
      ({ key, projectId, name, otherId }) => {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            projects: [
              { id: projectId, name },
              { id: otherId, name: 'Other project' },
            ],
          })
        );
      },
      { key, projectId, name, otherId }
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(origin + '/?presentation=sidenav&thread=a');
    const nav = page.getByRole('navigation', {
      name: 'Conversations',
      exact: true,
    });
    const projects = nav.getByRole('list', { name: 'Projects', exact: true });
    const trigger = projects.getByRole('button', {
      name: `More actions for project ${name} (${projectId})`,
      exact: true,
    });
    const otherTrigger = projects.getByRole('button', {
      name: `More actions for project Other project (${otherId})`,
      exact: true,
    });
    const selected = projects.getByRole('button', {
      name: 'Other project',
      exact: true,
    });
    const draft = page.getByRole('textbox', { name: 'Message', exact: true });
    const heading = page.getByRole('heading', {
      name: 'Retained project conversation',
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(draft).toBeEnabled();
    await selected.click();
    await draft.fill('Keep this exact menu draft.');
    const draftNode = await draft.elementHandle();
    const headingNode = await heading.elementHandle();
    const invokerNode = await trigger.elementHandle();
    assert.ok(draftNode && headingNode && invokerNode);
    const url = page.url();
    const saved = await page.evaluate((key) => localStorage.getItem(key), key);
    const menu = page.getByRole('menu', {
      name: `More actions for project ${name} (${projectId})`,
      exact: true,
    });
    const rename = page.getByRole('menuitem', { name: 'Rename', exact: true });
    const deletion = page.getByRole('menuitem', {
      name: 'Delete',
      exact: true,
    });
    const retained = async (storage = saved) => {
      expect(backend.requests).toHaveLength(3);
      expect(await page.evaluate((key) => localStorage.getItem(key), key)).toBe(
        storage
      );
      await expect(selected).toHaveAttribute('aria-current', 'true');
      await expect(heading).toBeVisible();
      await expect(
        page.getByText('Conversation ID: a', { exact: true })
      ).toBeVisible();
      await expect(draft).toHaveValue('Keep this exact menu draft.');
      expect(
        await draftNode.evaluate(
          (node) => node === document.querySelector('#message')
        )
      ).toBe(true);
      expect(
        await headingNode.evaluate(
          (node) => node === document.querySelector('#conversation-title')
        )
      ).toBe(true);
      expect(page.url()).toBe(url);
    };
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    await expect(rename).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await page.keyboard.press('ArrowDown');
    await expect(deletion).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(rename).toBeFocused();
    await page.keyboard.press('End');
    await expect(deletion).toBeFocused();
    await page.keyboard.press('Home');
    await expect(rename).toBeFocused();
    await page.screenshot({
      path: testInfo.outputPath('project-menu-desktop.png'),
      fullPage: false,
    });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await retained();
    await trigger.press('ArrowUp');
    await expect(deletion).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu).toHaveCount(0);
    await expect(
      projects.getByRole('button', { name: 'Other project', exact: true })
    ).toBeFocused();
    await retained();
    await trigger.click();
    await draft.click();
    await expect(menu).toHaveCount(0);
    await expect(draft).toBeFocused();
    await retained();
    await trigger.click();
    await otherTrigger.click();
    await expect(page.getByRole('menu')).toHaveCount(1);
    await expect(menu).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(otherTrigger).toBeFocused();
    await retained();
    await trigger.press('ArrowDown');
    await page.keyboard.press('Enter');
    const editor = nav.getByRole('textbox', {
      name: 'Project name',
      exact: true,
    });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue(name);
    await expect(page.getByRole('menu')).toHaveCount(0);
    await editor.fill('Discarded rename');
    await nav.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(trigger).toBeFocused();
    await retained();
    await trigger.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(editor).toBeFocused();
    const renamed = '<Renamed & literal>';
    await editor.fill(renamed);
    await nav.getByRole('button', { name: 'Save', exact: true }).click();
    const renamedTrigger = projects.getByRole('button', {
      name: `More actions for project ${renamed} (${projectId})`,
      exact: true,
    });
    await expect(renamedTrigger).toBeFocused();
    expect(
      await invokerNode.evaluate((node) => node === document.activeElement)
    ).toBe(true);
    const afterRename = JSON.stringify({
      version: 1,
      projects: [
        { id: projectId, name: renamed },
        { id: otherId, name: 'Other project' },
      ],
    });
    await retained(afterRename);
    await renamedTrigger.press('ArrowUp');
    await expect(deletion).toBeFocused();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('alertdialog', {
      name: 'Delete project?',
      exact: true,
    });
    await expect(dialog).toContainText(`${renamed} (${projectId})`);
    const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
    await expect(cancel).toBeFocused();
    await expect(page.getByRole('menu')).toHaveCount(0);
    await retained(afterRename);
    await cancel.click();
    await expect(renamedTrigger).toBeFocused();
    await retained(afterRename);
    await page
      .locator('html')
      .evaluate((node) => node.setAttribute('dir', 'rtl'));
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      const launcher = page.getByRole('button', {
        name: 'Open conversations',
        exact: true,
      });
      await expect(launcher).toBeVisible();
      await launcher.click();
      await expect(nav).toBeVisible();
      await expect(
        nav.getByRole('button', { name: 'Close conversations', exact: true })
      ).toBeFocused();
      await renamedTrigger.click();
      await expect(rename).toBeFocused();
      const rtlMenu = page.getByRole('menu', {
        name: `More actions for project ${renamed} (${projectId})`,
        exact: true,
      });
      await expect(rtlMenu).toBeVisible();
      await expect(rtlMenu).toHaveAttribute('dir', 'rtl');
      const box = await rtlMenu.boundingBox();
      assert.ok(box);
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.y + box.height).toBeLessThanOrEqual(844);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`project-menu-rtl-${width}.png`),
        fullPage: false,
      });
      await expect(rtlMenu).toBeVisible();
      await expect(renamedTrigger).toHaveAttribute('aria-expanded', 'true');
      await expect(rename).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(renamedTrigger).toBeFocused();
      await retained(afterRename);
      await nav
        .getByRole('button', { name: 'Close conversations', exact: true })
        .click();
      await expect(nav).toBeHidden();
    }
    for (const request of backend.requests)
      expect(request.headers['x-api-key']).toBe('project-menu-proof-key');
    backend.verify();
    for (const step of backend.steps)
      expect((await step.closed).finished).toBe(true);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await server?.close();
    await backend.close();
  }
});
