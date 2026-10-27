import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = '/deep-agents/skills/react/';
async function configure(
  request: APIRequestContext,
  scenario = 'reads',
  extra: Record<string, boolean> = {}
) {
  expect(
    (
      await request.post('/__configure', {
        data: {
          scenario,
          holdStream: false,
          holdState: false,
          holdCheckpoint: false,
          failCreation: false,
          failStream: false,
          failCheckpoint: false,
          ...extra,
        },
      })
    ).ok()
  ).toBe(true);
}
async function send(page: Page, text = 'What is the field data for KSFO?') {
  await page.getByRole('textbox', { name: 'Message' }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function saved(page: Page) {
  await expect(page.getByRole('status')).toHaveText('Response saved.', {
    timeout: 45000,
  });
}
async function proof(
  request: APIRequestContext,
  name: string,
  testInfo: TestInfo
) {
  mkdirSync(testInfo.outputDir, { recursive: true });
  for (const endpoint of ['requests', 'graph-proof', 'raw-events'])
    writeFileSync(
      testInfo.outputPath(`${name}-${endpoint}.json`),
      JSON.stringify(
        await (await request.get(`/__${endpoint}`)).json(),
        null,
        2
      )
    );
}
test('actual Skills root index, successful literal reads, followup and exact retained restoration', async ({
  page,
  request,
}, testInfo) => {
  await configure(request);
  const before = await (await request.get('/__requests')).json();
  await page.goto(base);
  await page.getByRole('button', { name: 'Mid-size jet at KASE' }).click();
  await expect(page.getByRole('textbox')).toHaveValue(
    'Can a mid-size jet operate out of KASE?'
  );
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await send(page, 'Can a mid-size jet operate out of KASE?');
  await saved(page);
  await expect(page.getByTestId('skills-source')).toHaveText(
    'Confirmed checkpoint'
  );
  await expect(
    page.getByRole('region', { name: 'Skills index' })
  ).toContainText('weather-brief');
  await expect(page.locator('[data-read-kind="inspected"]')).toHaveCount(2);
  const reads = page.getByRole('region', { name: 'Skill read observations' });
  await reads.getByText('Literal read result', { exact: true }).first().click();
  await expect(reads.locator('pre').first()).toContainText(
    '/skills/runway-analysis/reference/margins.md'
  );
  const prior = await page.getByLabel('Saved conversations').inputValue();
  await send(page, 'Followup');
  await saved(page);
  await expect(page.locator('[data-read-kind="inspected"]')).toHaveCount(4);
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await expect(page.locator('[data-read-kind]')).toHaveCount(0);
  const requestsBefore = await (await request.get('/__requests')).json();
  await page.getByLabel('Saved conversations').selectOption(prior);
  await expect(page.getByRole('status')).toContainText('saved');
  await expect(page.locator('[data-read-kind="inspected"]')).toHaveCount(4);
  const requestsAfter = await (await request.get('/__requests')).json();
  expect(
    requestsAfter.filter((r: { path: string }) =>
      r.path.endsWith('/runs/stream')
    ).length
  ).toEqual(
    requestsBefore.filter((r: { path: string }) =>
      r.path.endsWith('/runs/stream')
    ).length
  );
  await page.screenshot({
    path: testInfo.outputPath('skills-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('skills-mobile.png'),
    fullPage: true,
  });
  await proof(request, 'reads-restoration', testInfo);
});
for (const [scenario, kind, count] of [
  ['no-read', 'inspected', 0],
  ['partial', 'partial', 1],
  ['error', 'error', 1],
  ['alternate', 'inspected', 1],
] as const)
  test(`actual Skills ${scenario} remains evidence based`, async ({
    page,
    request,
  }, info) => {
    await configure(request, scenario);
    await page.goto(base);
    await send(page);
    await saved(page);
    await expect(page.locator(`[data-read-kind="${kind}"]`)).toHaveCount(count);
    await proof(request, scenario, info);
  });
test('New rejects stale held checkpoint and clears draft without replay', async ({
  page,
  request,
}, info) => {
  await configure(request, 'reads', { holdCheckpoint: true });
  await page.goto(base);
  await send(page);
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved conversation…'
  );
  await page.getByRole('button', { name: 'New conversation' }).click();
  await request.post('/__release', { data: {} });
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(page.locator('[data-read-kind]')).toHaveCount(0);
  await expect(page.getByRole('textbox')).toHaveValue('');
  await proof(request, 'stale-new', info);
});
test('Stop and failed transport require New and never replay', async ({
  page,
  request,
}, info) => {
  await configure(request, 'reads', { holdStream: true });
  await page.goto(base);
  await send(page);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('textbox')).toBeDisabled();
  await request.post('/__release', { data: {} });
  await page.getByRole('button', { name: 'New conversation' }).click();
  await configure(request, 'reads', { failStream: true });
  await send(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  await proof(request, 'stop-error', info);
});

test('duplicate Send and exact confirmation failure cannot silently replay', async ({
  page,
  request,
}, info) => {
  await configure(request, 'reads', { failCheckpoint: true });
  await page.goto(base);
  const before = (await (await request.get('/__requests')).json()).length;
  await page
    .getByRole('textbox')
    .fill('Can a mid-size jet operate out of KASE?');
  await page
    .getByRole('button', { name: 'Send', exact: true })
    .evaluate((element) => {
      const button = element as HTMLButtonElement;
      button.click();
      button.click();
    });
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  const requests = (await (await request.get('/__requests')).json()).slice(
    before
  );
  expect(
    requests.filter((r: { path: string }) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  await proof(request, 'duplicate-exact-failure', info);
});
test('creation failure remains unavailable without authoring a run', async ({
  page,
  request,
}, info) => {
  await configure(request, 'reads', { failCreation: true });
  await page.goto(base);
  const before = (await (await request.get('/__requests')).json()).length;
  await send(page);
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  const requests = (await (await request.get('/__requests')).json()).slice(
    before
  );
  expect(
    requests.filter((r: { path: string }) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(0);
  await proof(request, 'creation-failure', info);
});
