import {
  expect,
  test,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
const base = '/deep-agents/planning/react/';
async function configure(
  request: APIRequestContext,
  values: Record<string, string | boolean>
) {
  const response = await request.post('/__configure', {
    data: {
      holdStream: false,
      holdState: false,
      holdCheckpoint: false,
      failCreation: false,
      failStream: false,
      failCheckpoint: false,
      scenario: 'normal',
      ...values,
    },
  });
  expect(response.ok()).toBe(true);
}
async function send(page: Page, text = 'Dispatch brief: KSFO to KASE') {
  const box = page.getByRole('textbox', { name: 'Message' });
  await box.fill(text);
  await box.press('Enter');
}
const plan = (page: Page) => page.getByRole('complementary', { name: 'Plan' });
for (const width of [375, 1280]) {
  test(`populated conversation scrolls independently of composer at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 900 });
    await send(page, Array.from({ length: 80 }, (_, index) =>
      `Dispatch question ${index + 1}: explain the runway, weather, and terrain considerations for this flight.`
    ).join('\n\n'));
    await expect(page.getByText('Response saved.', { exact: true })).toBeVisible();
    const transcript = page.locator('.conversation-panel .tp-chat > .tp-chat-list');
    const input = page.getByRole('textbox', { name: 'Message' });
    await expect.poll(() => transcript.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    const inputBox = await input.boundingBox();
    expect(inputBox).not.toBeNull();
    for (const position of ['start', 'end'] as const) {
      await transcript.evaluate((element, position) => {
        element.scrollTop = position === 'start' ? 0 : element.scrollHeight;
      }, position);
      await expect.poll(() => input.evaluate(element => {
        const b = element.getBoundingClientRect();
        return b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth &&
          [[b.x + b.width / 2, b.y + b.height / 2], [b.left + 2, b.top + 2],
            [b.right - 2, b.top + 2], [b.left + 2, b.bottom - 2], [b.right - 2, b.bottom - 2]]
            .every(([x, y]) => document.elementFromPoint(x, y) === element);
      })).toBe(true);
      expect((await input.boundingBox())?.y).toBe(inputBox?.y);
      expect(await page.evaluate(() => scrollY)).toBe(0);
    }
    expect(await transcript.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    await plan(page).getByText('Saved plan', { exact: true }).scrollIntoViewIfNeeded();
    await expect(plan(page).getByText('Saved plan', { exact: true })).toBeInViewport();
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  });
}
test.beforeEach(async ({ page, request }) => {
  await configure(request, {});
  await page.goto(base);
});
test('mount is inert; the welcome suggestion sends and native live replacement becomes saved with unfinished task', async ({
  page,
  request,
}) => {
  const before = (await (await request.get('/__requests')).json()).length;
  await page.reload();
  await expect(page.getByText('Ready.', { exact: true })).toBeVisible();
  await expect(page.getByText('Start with what you want to do.')).toBeVisible();
  expect((await (await request.get('/__requests')).json()).length).toBe(before);
  await configure(request, { holdCheckpoint: true });
  await page
    .getByRole('button', { name: 'Dispatch brief: KSFO to KASE' })
    .click();
  // The run replaces the welcome greeting with Chat's default transcript.
  await expect(page.getByText('Start with what you want to do.')).toHaveCount(0);
  await expect(page.getByText('Confirming saved plan…')).toBeVisible();
  await expect(plan(page).getByText('3 of 4 completed')).toBeVisible();
  await expect(
    plan(page).getByText('Live plan · waiting for confirmation')
  ).toBeVisible();
  await request.post('/__release');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(
    plan(page).locator('[data-plan-status="in_progress"]')
  ).toHaveCount(1);
  await expect(
    plan(page).getByText('Saved plan', { exact: true })
  ).toBeVisible();
  if (process.env.PLANNING_CAPTURE_SCREENSHOTS === '1')
    await page.screenshot({
      path: '/tmp/threadplane-planning-task3-desktop.png',
      fullPage: true,
    });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  const proof = await (await request.get('/__graph-proof')).json();
  expect(
    proof.every(
      (row: { actualCompiledGraph: boolean; networkConnectAttempts: number }) =>
        row.actualCompiledGraph && row.networkConnectAttempts === 0
    )
  ).toBe(true);
});
test('failed creation retries; native stream failure retains saved plan', async ({
  page,
  request,
}) => {
  await configure(request, { failCreation: true });
  await send(page);
  await expect(
    page.getByText('Response failed.', { exact: true })
  ).toBeVisible();
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  await configure(request, { failStream: true });
  await send(page, 'Again');
  await expect(
    page.getByText('Response failed.', { exact: true })
  ).toBeVisible();
  await expect(
    plan(page).getByText('Last saved plan', { exact: true })
  ).toBeVisible();
  await expect(plan(page).getByText('3 of 4 completed')).toBeVisible();
});
test('uncertain changed checkpoint and no-write cannot borrow plan; later legitimate write recovers', async ({
  page,
  request,
}) => {
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  await configure(request, { scenario: 'duplicates', failCheckpoint: true });
  await send(page, 'Change');
  await expect(page.getByText('Plan update unconfirmed.')).toBeVisible();
  await expect(
    plan(page).getByText('Last saved plan', { exact: true })
  ).toBeVisible();
  await configure(request, { scenario: 'no-write' });
  await send(page, 'Just answer');
  await expect(page.getByText('Plan update unconfirmed.')).toBeVisible();
  await configure(request, { scenario: 'recovery' });
  await send(page, 'Recover');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(
    plan(page).getByText('Recovered', { exact: true })
  ).toBeVisible();
  await expect(plan(page).getByText('0 of 1 completed')).toBeVisible();
});
test('stop holds saved authority, ignores late stream, and New clears without creating thread', async ({
  page,
  request,
}) => {
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  await configure(request, { scenario: 'duplicates', holdStream: true });
  await send(page, 'Change');
  await expect(page.getByRole('button', { name: 'Stop' })).toBeVisible();
  await expect
    .poll(async () => (await (await request.get('/__lifetime')).json()).held)
    .toBe(1);
  await page.getByRole('button', { name: 'Stop' }).click();
  await expect(
    page.getByText('Response stopped.', { exact: true })
  ).toBeVisible();
  await request.post('/__release');
  await expect(plan(page).getByText('3 of 4 completed')).toBeVisible();
  const before = (await (await request.get('/__requests')).json()).filter(
    (row: { path: string }) => row.path === '/api/threads'
  ).length;
  await page.getByRole('button', { name: 'New conversation' }).click();
  await expect(plan(page).getByText(/Ask the assistant/)).toBeVisible();
  expect(
    (await (await request.get('/__requests')).json()).filter(
      (row: { path: string }) => row.path === '/api/threads'
    ).length
  ).toBe(before);
});
test('New during held checkpoint ignores stale owner; new send owns its conversation', async ({
  page,
  request,
}) => {
  await configure(request, { holdCheckpoint: true });
  await send(page);
  await expect(page.getByText('Confirming saved plan…')).toBeVisible();
  await page.getByRole('button', { name: 'New conversation' }).click();
  await request.post('/__release');
  await expect(plan(page).getByText(/Ask the assistant/)).toBeVisible();
  await expect(page.getByRole('article')).toHaveCount(0);
  await configure(request, { scenario: 'empty' });
  await send(page, 'Clear');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(plan(page).getByText('The plan is empty.')).toBeVisible();
});
test('whole-list duplicates and empty replacement remain ordered and read-only', async ({
  page,
  request,
}) => {
  await configure(request, { scenario: 'duplicates' });
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  const items = plan(page).locator('.plan-items > li');
  await expect(items).toHaveCount(3);
  await expect(items.nth(0)).toContainText('Duplicate');
  await expect(items.nth(1)).toContainText('Duplicate');
  await expect(items.nth(2)).toContainText('First');
  await expect(plan(page).getByRole('checkbox')).toHaveCount(0);
  await configure(request, { scenario: 'empty' });
  await send(page, 'Clear');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(plan(page).getByText('0 of 0 completed')).toBeVisible();
  await expect(items).toHaveCount(0);
});
test('actual rejected write results remain received tool traces and recover without implying application', async ({
  page,
  request,
}) => {
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  for (const scenario of ['parallel', 'schema']) {
    await configure(request, { scenario });
    await send(page, 'Rejected write');
    await expect(page.getByText('Plan update unconfirmed.')).toBeVisible();
    await expect(
      plan(page).getByText('Last saved plan', { exact: true })
    ).toBeVisible();
    // Chat's default tool rows show the rejected calls and their literal results.
    expect(
      (await page.locator('.tp-tool-activity__heading').allTextContents()).some(
        (text) => text.startsWith('Write todos')
      )
    ).toBe(true);
    await expect(page.locator('.tp-chat-message--tool').last()).not.toBeEmpty();
    expect(
      (await page.locator('.tp-tool-activity-group').allTextContents()).some(
        (text) => /applied|success/i.test(text)
      )
    ).toBe(false);
  }
  await configure(request, { scenario: 'recovery' });
  await send(page, 'Recover');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(
    plan(page).getByText('Recovered', { exact: true })
  ).toBeVisible();
});
test('bounds-invalid actual write retains valid display and shows notice; valid recovery clears notice', async ({
  page,
  request,
}) => {
  await send(page);
  await expect(page.getByText('Response saved.')).toBeVisible();
  await configure(request, { scenario: 'oversized' });
  await send(page, 'Too many');
  await expect(page.getByText('Plan update unconfirmed.')).toBeVisible();
  await expect(
    plan(page).getByText(/Plans support up to 50 items/)
  ).toBeVisible();
  await expect(plan(page).getByText('3 of 4 completed')).toBeVisible();
  await configure(request, { scenario: 'empty-content' });
  await send(page, 'Recover');
  await expect(page.getByText('Response saved.')).toBeVisible();
  await expect(plan(page).getByText('Untitled item')).toBeVisible();
  await expect(plan(page).getByText(/Plans support/)).toHaveCount(0);
});
test('mobile, keyboard and reduced motion preserve readable literal plan without horizontal overflow', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page
    .getByRole('button', { name: 'Dispatch brief: KSFO to KASE' })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Response saved.')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  await expect(plan(page).getByText('3 of 4 completed')).toBeVisible();
  if (process.env.PLANNING_CAPTURE_SCREENSHOTS === '1')
    await page.screenshot({
      path: '/tmp/threadplane-planning-task3-mobile.png',
      fullPage: true,
    });
  await configure(request, { scenario: 'long-content' });
  await send(page, 'Long literal plan');
  await expect(page.getByText('Response saved.')).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
  expect(
    await page.evaluate(
      () => matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  ).toBe(true);
});
