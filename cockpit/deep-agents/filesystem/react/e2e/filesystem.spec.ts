import { test, expect } from '@playwright/test';
// Backend: aimock replays the recorded Angular fixtures
// (cockpit/deep-agents/filesystem/angular/e2e/fixtures) into a real
// `langgraph dev`; the suggestion prompt is the recorded one, so the files and
// the protected-write approval are the real graph's.
const base = '/deep-agents/filesystem/react/';
test('installed native candidate keeps draft inert, shows actual pause, then approves complete batch', async ({
  page,
  request,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(base);
  await expect(page.getByRole('status')).toContainText('Ready.');
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await page.getByRole('button', { name: 'Runway note for KASE' }).click();
  await expect(page.getByRole('textbox', { name: 'Message' })).toHaveValue(
    /Work up a runway suitability note/
  );
  expect(await (await request.get('/__requests')).json()).toEqual([]);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Approve entire batch' })
  ).toBeVisible();
  await expect(page.getByRole('region', { name: 'Workspace' })).toContainText(
    'KASE Field Elevation: 7,820 ft'
  );
  await expect(
    page.getByRole('region', { name: 'Awaiting approval' })
  ).toContainText('New file proposal');
  await page.screenshot({
    path: '/tmp/threadplane-filesystem-task3-paused-desktop.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: '/tmp/threadplane-filesystem-task3-paused-mobile.png',
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.getByRole('button', { name: 'Approve entire batch' }).click();
  await expect(page.getByRole('status')).toContainText('Response saved.');
  await page
    .getByRole('button', { name: '/reports/kase-runway.md', exact: true })
    .click();
  await expect(page.getByRole('region', { name: 'Workspace' })).toContainText(
    'Runway Suitability Note: KASE'
  );
  await page.screenshot({
    path: '/tmp/threadplane-filesystem-task3-terminal-mobile.png',
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: '/tmp/threadplane-filesystem-task3-terminal-desktop.png',
    fullPage: true,
  });
  const requests = await (await request.get('/__requests')).json();
  expect(requests.filter((x) => x.body?.input?.messages)).toHaveLength(1);
  expect(
    requests.filter((x) => x.body?.command).map((x) => x.body.command)
  ).toEqual([{ resume: { decisions: [{ type: 'approve' }] } }]);
  expect(pageErrors).toEqual([]);
});
