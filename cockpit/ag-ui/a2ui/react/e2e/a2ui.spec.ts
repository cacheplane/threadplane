import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';

interface CanonicalPost {
  kind: 'actual-canonical-post';
  threadId: string;
  runId: string;
  body: { messages: { content: string }[] };
  rawBody: string;
  response: { rawWire: string };
}
interface OwnerReceipt {
  stats: {
    ready: { pid: number };
    closure: {
      worker: boolean;
      listener: boolean;
      sockets: boolean;
      responses: boolean;
    };
    requests: {
      body: { protocolVersion: string };
      rawBody: string;
      sentWire: string[];
      worker: {
        events: unknown[];
        observations: {
          requestCount: number;
          deniedNetwork: unknown[];
          state: { values: { messages: unknown[] } };
        };
      };
    }[];
  };
}
interface GenerationReceipt {
  holds: number;
  closed: boolean;
  proxyResponsesClosed: boolean;
  owners: OwnerReceipt[];
  requests: (CanonicalPost | { kind: 'fake-negative-transport' })[];
}
interface ManagerReceipt {
  current: GenerationReceipt;
  archived: GenerationReceipt[];
}

const base = '/ag-ui/a2ui/react/';
const current = (page: Page) =>
  page.getByRole('region', { name: 'Current flight preview', exact: true });
const earlier = (page: Page) =>
  page.getByRole('region', { name: 'Earlier flight preview', exact: true });
const lifetime = async (request: APIRequestContext): Promise<ManagerReceipt> =>
  (await request.get('/__lifetime')).json();
const posts = (receipt: ManagerReceipt) =>
  receipt.current.requests.filter(
    (record): record is CanonicalPost => record.kind === 'actual-canonical-post'
  );
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
  await expect(page.getByRole('status')).toHaveText('Ready.');
});
test.afterEach(async ({ request }, info) => {
  const receipt = await lifetime(request),
    path = info.outputPath('canonical-manager-receipt.json');
  await writeFile(path, JSON.stringify(receipt, null, 2));
  await info.attach('canonical-manager-receipt', {
    path,
    contentType: 'application/json',
  });
  // Archive and verify all canonical children before another browser case starts.
  expect((await request.post('/__reset')).ok()).toBe(true);
  const closed = await lifetime(request);
  for (const generation of closed.archived) {
    expect(generation.closed).toBe(true);
    expect(generation.proxyResponsesClosed).toBe(true);
    for (const owner of generation.owners)
      expect(owner.stats.closure).toEqual({
        worker: true,
        listener: true,
        sockets: true,
        responses: true,
      });
  }
});

test('four actual native turns preserve edited Search, Select and server-restored Modify', async ({
  page,
  request,
}, info) => {
  expect(posts(await lifetime(request))).toHaveLength(0);
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  expect(posts(await lifetime(request))).toHaveLength(0);
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
  const receipt = await lifetime(request),
    requests = posts(receipt);
  expect(requests).toHaveLength(4);
  expect(receipt.current.owners).toHaveLength(1);
  const owner = receipt.current.owners[0];
  expect(new Set(requests.map((record) => record.threadId)).size).toBe(1);
  expect(new Set(requests.map((record) => record.runId)).size).toBe(4);
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
  for (const [index, record] of owner.stats.requests.entries()) {
    const observation = record.worker.observations;
    expect(observation.requestCount).toBe(index + 1);
    expect(observation.state.values.messages).toHaveLength((index + 1) * 2);
    expect(observation.deniedNetwork).toEqual([]);
    expect(record.body.protocolVersion).toBe('1.0');
    expect(record.rawBody).toBe(requests[index].rawBody);
    expect(record.sentWire.join('')).toBe(requests[index].response.rawWire);
    expect(record.worker.events).toContainEqual({
      type: 'RUN_FINISHED',
      threadId: requests[index].threadId,
      runId: requests[index].runId,
    });
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
    expect(posts(await lifetime(request))).toHaveLength(1);
  }
  await edit(page);
  await request.post('/__hold/stream');
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .evaluate((button: HTMLButtonElement) => {
      button.click();
      button.click();
    });
  await expect
    .poll(async () => (await lifetime(request)).current.holds)
    .toBe(1);
  expect(posts(await lifetime(request))).toHaveLength(2);
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
  expect(posts(await lifetime(request))).toHaveLength(2);
});

test('Stop, fake transport error, New and held old completion cannot regain authority', async ({
  page,
  request,
}) => {
  await form(page);
  await edit(page);
  await request.post('/__hold/stream');
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .click();
  await expect
    .poll(async () => (await lifetime(request)).current.holds)
    .toBe(1);
  await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
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
  // The new owner completes while the old encoded response is still held.
  await expect
    .poll(async () => (await lifetime(request)).current.holds)
    .toBe(1);
  await request.post('/__release');
  const first = await lifetime(request);
  expect(first.current.owners).toHaveLength(2);
  expect(
    new Set(first.current.owners.map((owner) => owner.stats.ready.pid)).size
  ).toBe(2);
  await expect(earlier(page)).toHaveCount(0);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await request.post('/__fail-transport');
  await page.getByRole('button', { name: 'Try a flight request' }).click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .press('Enter');
  await expect(page.getByRole('status')).toHaveText(
    'Start a new conversation to continue.'
  );
  expect(
    (await lifetime(request)).current.requests.filter(
      (record) => record.kind === 'fake-negative-transport'
    )
  ).toHaveLength(1);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await form(page);
  await request.post('/__hold/stream');
  await edit(page);
  await current(page)
    .getByRole('button', { name: 'Search flights', exact: true })
    .click();
  await expect
    .poll(async () => (await lifetime(request)).current.holds)
    .toBe(1);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await request.post('/__hold/off');
  await form(page);
  await request.post('/__release');
  const before = posts(await lifetime(request)).length;
  await page.evaluate(() =>
    window.dispatchEvent(new PageTransitionEvent('pagehide'))
  );
  await request.post('/__release');
  expect(posts(await lifetime(request))).toHaveLength(before);
  await expect(page.locator('main')).toHaveCount(0);
});
