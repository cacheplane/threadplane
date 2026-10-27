import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type TestInfo,
} from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const base = '/deep-agents/subagents/react/';
async function configure(
  request: APIRequestContext,
  scenario = 'single',
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
async function canonicalCards(page: Page, request: APIRequestContext) {
  const runs = (await (await request.get('/__raw-events')).json()) as {
    events: [
      string[],
      string,
      {
        messages?: {
          id: string;
          type: string;
          content: string;
          tool_call_id?: string;
          tool_calls?: { id: string; name: string; args: unknown }[];
        }[];
      }
    ][];
  }[];
  const messages = runs
    .at(-1)
    ?.events.filter((e) => e[0].length === 0 && e[1] === 'values')
    .at(-1)?.[2].messages;
  if (!messages) throw Error('Missing actual root events');
  const calls = messages.flatMap((m) => m.tool_calls ?? []);
  expect(
    await page
      .locator('.tool-observation')
      .evaluateAll((cards) => cards.map((c) => c.getAttribute('data-call-id')))
  ).toEqual(calls.map((c) => c.id));
  for (const call of calls) {
    const result = messages.find(
      (m) => m.type === 'tool' && m.tool_call_id === call.id
    );
    if (result)
      await expect(
        page.locator(`.tool-observation[data-call-id="${call.id}"] pre`).last()
      ).toHaveText(result.content);
  }
}
test('actual compiled single dispatch and inert draft lifecycle', async ({
  page,
  request,
}, testInfo) => {
  await configure(request);
  const before = await (await request.get('/__requests')).json();
  await page.goto(base);
  await expect(page.getByRole('textbox')).toBeEnabled();
  await page.getByRole('button', { name: 'Field data for KSFO' }).click();
  await expect(page.getByRole('textbox')).toHaveValue(
    'What is the field data for KSFO?'
  );
  expect(await (await request.get('/__requests')).json()).toEqual(before);
  await page.reload();
  await expect(page.getByRole('textbox')).toHaveValue('');
  await send(page);
  await saved(page);
  await expect(page.getByLabel('Observed dispatch count')).toHaveText(
    '1 observed task dispatches'
  );
  await expect(page.locator('.tool-observation')).toHaveCount(1);
  await expect(page.locator('.tool-observation')).toContainText('KSFO');
  await page.getByText('Child response observations', { exact: true }).click();
  await expect(page.locator('.child-observations section')).toHaveCount(1);
  await expect(page.locator('.child-observations')).toContainText('user');
  await expect(page.locator('.child-observations')).toContainText('tool');
  await canonicalCards(page, request);
  await proof(request, 'single', testInfo);
  await page.screenshot({
    path: testInfo.outputPath('single-desktop.png'),
    fullPage: true,
  });
});
test('parallel actual native observations survive canonical load and followup', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, 'parallel');
  await page.goto(base);
  await send(
    page,
    'Brief me on KASE and KDEN: I need field data for both and the current weather at both.'
  );
  await saved(page);
  await expect(page.getByLabel('Observed dispatch count')).toHaveText(
    '4 observed task dispatches'
  );
  await expect(page.locator('.tool-observation')).toHaveCount(4);
  await page.getByText('Child response observations', { exact: true }).click();
  await expect(page.locator('.child-observations section')).toHaveCount(4);
  await expect(page.locator('.child-observations')).toContainText(
    'Observed response'
  );
  await page.screenshot({
    path: testInfo.outputPath('parallel-desktop.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('parallel-mobile.png'),
    fullPage: true,
  });
  await send(page, 'Brief me on KASE and KDEN again.');
  await saved(page);
  await expect(page.getByLabel('Observed dispatch count')).toHaveText(
    '8 observed task dispatches'
  );
  await expect(page.locator('.child-observations section')).toHaveCount(8);
  await canonicalCards(page, request);
  await proof(request, 'canonical-followup', testInfo);
});
for (const [scenario, count] of [
  ['duplicates', 4],
  ['no-task', 0],
  ['general-purpose', 1],
  ['default-tool', 0],
  ['root-tool-error', 1],
  ['tool-error', 1],
] as const) {
  test(`actual ${scenario} preserves resolved authority and literal fields`, async ({
    page,
    request,
  }, testInfo) => {
    await configure(request, scenario);
    await page.goto(base);
    await send(page, 'Dispatch request.');
    await saved(page);
    await expect(page.getByLabel('Observed dispatch count')).toHaveText(
      `${count} observed task dispatches`
    );
    if (scenario === 'root-tool-error') {
      await page.screenshot({
        path: testInfo.outputPath('root-tool-error-desktop.png'),
        fullPage: true,
      });
      await expect(page.getByText('Tool result: error')).toBeVisible();
      await expect(page.getByText('Task fields unavailable')).toBeVisible();
    }
    if (scenario === 'tool-error') {
      await expect(page.locator('.tool-observation')).toContainText(
        "Error invoking tool 'lookup_field_elevation'"
      );
      await page
        .getByText('Child response observations', { exact: true })
        .click();
      await expect(page.locator('.child-observations')).toContainText(
        'airport: Field required'
      );
      await expect(page.locator('.child-observations')).toContainText(
        'Observed response'
      );
      await expect(page.locator('.child-observations')).not.toContainText(
        'Saved'
      );
      await page.screenshot({
        path: testInfo.outputPath('child-tool-error-desktop.png'),
        fullPage: true,
      });
    }
    if (scenario === 'duplicates')
      await expect(page.locator('.tool-observation')).toHaveCount(4);
    await canonicalCards(page, request);
    await proof(request, scenario, testInfo);
  });
}
test('Stop and New invalidate held delivery without hidden replay', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, 'parallel', { holdStream: true });
  await page.goto(base);
  const before = (await (await request.get('/__requests')).json()).length;
  await send(page, 'Dispatch request.');
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('stopped');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('textbox')).toBeEnabled();
  await request.post('/__release', { data: {} });
  await expect(page.locator('.tool-observation')).toHaveCount(0);
  const requests = (await (await request.get('/__requests')).json()).slice(
    before
  );
  expect(
    requests.filter((r: { path: string }) => r.path.endsWith('/runs/stream'))
  ).toHaveLength(1);
  await proof(request, 'stop-new', testInfo);
});
test('exact checkpoint transport failure blocks followup', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, 'single', { failCheckpoint: true });
  await page.goto(base);
  await send(page);
  await expect(page.getByRole('alert')).toBeVisible({ timeout: 45000 });
  await expect(page.getByRole('textbox')).toBeDisabled();
  await proof(request, 'checkpoint-failure', testInfo);
});

test('active New isolates a held saved checkpoint and cannot resurrect it', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, 'single', { holdCheckpoint: true });
  await page.goto(base);
  await send(page);
  await expect(page.getByRole('status')).toHaveText(
    'Confirming saved conversation…'
  );
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(page.getByRole('textbox')).toBeEnabled();
  await request.post('/__release', { data: {} });
  await expect(page.locator('.tool-observation')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await proof(request, 'new-pending-checkpoint', testInfo);
});
test('oversized literal draft is rejected without a backend thread', async ({
  page,
  request,
}) => {
  await configure(request);
  const before = (await (await request.get('/__requests')).json()).length;
  await page.goto(base);
  await send(page, '<img src=x onerror=alert(1)>'.repeat(3000));
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('textbox')).toBeDisabled();
  expect((await (await request.get('/__requests')).json()).length).toBe(before);
  expect(await page.locator('img').count()).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
});

test('duplicate Send and transport failure cannot cause automatic replay', async ({
  page,
  request,
}, testInfo) => {
  await configure(request, 'single', { failStream: true });
  await page.goto(base);
  const before = (await (await request.get('/__requests')).json()).length;
  await page.getByRole('textbox').fill('What is the field data for KSFO?');
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
  await proof(request, 'duplicate-send-transport-failure', testInfo);
});
