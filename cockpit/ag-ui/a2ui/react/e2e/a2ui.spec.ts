import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Backend: aimock replays cockpit/ag-ui/a2ui/angular/e2e/fixtures (the
// react-parity A2UI model's outputs for this flow) into the example's real
// AG-UI server, whose real tools search flights and look one up. The
// recording proxy (scripts/react-cockpit/ag-ui-proxy.mjs) records each agent
// POST with the real events, and holds or fails the next run.
interface AgentPost {
  path: string;
  body: { threadId: string; runId: string; protocolVersion: string; messages: { content: string }[] };
  events: { type: string; threadId?: string; runId?: string }[];
  held: boolean;
  closed: boolean;
}
const base = '/ag-ui/a2ui/react/';
const current = (page: Page) =>
  page.getByRole('region', { name: 'Current flight preview', exact: true });
const earlier = (page: Page) =>
  page.getByRole('region', { name: 'Earlier flight preview', exact: true });
const lifetime = async (request: APIRequestContext): Promise<{ active: boolean; openResponses: number }> =>
  (await request.get('/__lifetime')).json();
const posts = async (request: APIRequestContext): Promise<AgentPost[]> =>
  (await request.get('/__requests')).json();
async function form(page: Page) {
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .press('Enter');
  await expect(
    current(page).getByRole('heading', { name: 'Book a flight', exact: true })
  ).toBeVisible({ timeout: 25000 });
}
async function edit(page: Page, passengers = '003') {
  await current(page).getByLabel('Origin', { exact: true }).selectOption('SFO');
  await current(page)
    .getByLabel('Destination', { exact: true })
    .selectOption('SEA');
  await current(page)
    .getByLabel('Departure date (YYYY-MM-DD)', { exact: true })
    .fill('2027-02-17');
  await current(page)
    .getByLabel('Passengers', { exact: true })
    .fill(passengers);
  await current(page)
    .getByLabel('Fare class', { exact: true })
    .selectOption('Business');
}
test.beforeEach(async ({ page, request }) => {
  expect((await request.post('/__reset')).ok()).toBe(true);
  await page.goto(base);
  await expect(
    page.getByRole('heading', { name: 'Plan a flight', exact: true })
  ).toBeVisible();
  await expect(page.getByRole('status', { name: 'Conversation status' })).toHaveText('Ready.');
});
test.afterEach(async ({ page, request }, info) => {
  const path = info.outputPath('agent-requests.json');
  await writeFile(path, JSON.stringify(await posts(request), null, 2));
  await info.attach('agent-requests', { path, contentType: 'application/json' });
  // No proxied agent stream outlives the case.
  await page.goto('about:blank');
  await expect.poll(async () => (await lifetime(request)).openResponses).toBe(0);
});

test('four actual native turns preserve edited Search, Select and server-restored Modify', async ({
  page,
  request,
}, info) => {
  expect(await posts(request)).toHaveLength(0);
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  expect(await posts(request)).toHaveLength(0);
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .press('Enter');
  await expect(current(page).getByLabel('Origin', { exact: true })).toHaveValue(
    'LAX',
    { timeout: 25000 }
  );
  await edit(page);
  await page.screenshot({
    path: info.outputPath('edited-form.png'),
    fullPage: true,
  });
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .click();
  await expect(
    current(page).getByRole('heading', { name: 'UA flight UA204' })
  ).toBeVisible();
  await expect(
    earlier(page).getByLabel('Passengers', { exact: true })
  ).toHaveValue('003');
  await expect(
    earlier(page).getByLabel('Passengers', { exact: true })
  ).toBeDisabled();
  await current(page)
    .getByRole('button', { name: 'Select', exact: true })
    .click();
  await expect(
    current(page).getByRole('button', { name: 'Modify search', exact: true })
  ).toBeVisible();
  await expect(current(page)).toContainText('3 passengers');
  await current(page)
    .getByRole('button', { name: 'Modify search', exact: true })
    .click();
  for (const [label, value] of [
    ['Origin', 'SFO'],
    ['Destination', 'SEA'],
    ['Departure date (YYYY-MM-DD)', '2027-02-17'],
    ['Passengers', '3'],
    ['Fare class', 'Business'],
  ])
    await expect(current(page).getByLabel(label, { exact: true })).toHaveValue(
      value
    );
  await expect(earlier(page)).toHaveCount(3);
  const requests = await posts(request);
  expect(requests).toHaveLength(4);
  expect(new Set(requests.map((record) => record.body.threadId)).size).toBe(1);
  expect(new Set(requests.map((record) => record.body.runId)).size).toBe(4);
  const action = (turn: number) => {
    const message = requests[turn].body.messages.at(-1);
    expect(message).toBeDefined();
    if (!message) throw Error('Missing submitted native message');
    return JSON.parse(message.content).action;
  };
  expect(action(1)).toMatchObject({
    name: 'bookingSubmit',
    surfaceId: 'booking',
    context: {
      formId: 'booking',
      origin: ['SFO'],
      dest: ['SEA'],
      date: '2027-02-17',
      passengers: 3,
      fare_class: ['Business'],
    },
  });
  expect(action(2)).toMatchObject({
    name: 'flightSelect',
    context: { flightId: 'UA204' },
  });
  expect(action(3).name).toBe('modifySearch');
  // Each turn is one real run that the server finished for that thread and run.
  for (const record of requests) {
    expect(record.body.protocolVersion).toBe('1.0');
    expect(record.events).toContainEqual(
      expect.objectContaining({ type: 'RUN_FINISHED', threadId: record.body.threadId, runId: record.body.runId })
    );
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth
    )
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath('mobile-restored.png'),
    fullPage: true,
  });
});

test('invalid drafts focus the field and repeated busy Search sends exactly one real POST', async ({
  page,
  request,
}) => {
  await form(page);
  await edit(page);
  const passengers = current(page).getByLabel('Passengers', { exact: true });
  for (const value of ['', '0', '9007199254740992']) {
    await passengers.fill(value);
    await current(page)
      .getByRole('button', { name: 'Search flights', exact: true })
      .click();
    await expect(passengers).toHaveValue(value);
    await expect(passengers).toBeFocused();
    await expect(passengers).toHaveAttribute('aria-invalid', 'true');
    expect(await posts(request)).toHaveLength(1);
  }
  await edit(page);
  // A2UI runs stream structured tool calls, no text: hold right after the start.
  await request.post('/__hold/stream', { data: { afterType: 'RUN_STARTED' } });
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(async () => (await lifetime(request)).active)
    .toBe(true);
  expect(await posts(request)).toHaveLength(2);
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Stop', exact: true })
  ).toBeVisible();
  await request.post('/__release');
  await expect(
    current(page).getByRole('button', { name: 'Select', exact: true })
  ).toBeVisible();
  expect(await posts(request)).toHaveLength(2);
});

test('Stop, failed transport, New and a held old run cannot regain authority', async ({
  page,
  request,
}) => {
  await form(page);
  await edit(page);
  // Hold every run right after it starts until /__hold/off.
  await request.post('/__hold/stream', { data: { afterType: 'RUN_STARTED', persist: true } });
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .click();
  await expect
    .poll(async () => (await lifetime(request)).active)
    .toBe(true);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Conversation status' })).toHaveText(
    'Start a new conversation to continue.'
  );
  // Stop closes the held stream itself: nothing late can reach the page.
  await expect
    .poll(async () => (await lifetime(request)).active)
    .toBe(false);
  await expect(
    earlier(page).getByLabel('Passengers', { exact: true })
  ).toHaveValue('003');
  await expect(
    earlier(page).getByLabel('Passengers', { exact: true })
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await request.post('/__hold/off');
  await form(page);
  await request.post('/__release');
  await expect(earlier(page)).toHaveCount(0);
  const threads = new Set((await posts(request)).map((record) => record.body.threadId));
  expect(threads.size).toBe(2);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  // The next agent POST answers 500 without reaching the server.
  await request.post('/__fail-stream');
  const beforeFailure = (await posts(request)).length;
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .press('Enter');
  await expect(page.getByRole('status', { name: 'Conversation status' })).toHaveText(
    'Start a new conversation to continue.'
  );
  expect(await posts(request)).toHaveLength(beforeFailure + 1);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await form(page);
  await request.post('/__hold/stream', { data: { afterType: 'RUN_STARTED', persist: true } });
  await edit(page);
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .click();
  await expect
    .poll(async () => (await lifetime(request)).active)
    .toBe(true);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect
    .poll(async () => (await lifetime(request)).active)
    .toBe(false);
  await request.post('/__hold/off');
  await form(page);
  await request.post('/__release');
  const before = (await posts(request)).length;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  );
  await request.post('/__release');
  expect(await posts(request)).toHaveLength(before);
  await expect(page.locator('main')).toHaveCount(0);
});
