import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const path = '/runtimes/mastra/react/';
// Backend: aimock replays cockpit/runtimes/mastra/angular/e2e/fixtures (shared
// with the Angular example, which sends the same reservation prompt) into the
// real deployments/ag-ui-mastra service, behind the recording proxy
// (scripts/react-cockpit/ag-ui-proxy.mjs).
/** Every agent POST: what the service streamed (`events`) and the browser got (`sent`). */
async function requests(request: APIRequestContext) {
  return (await request.get('/__requests')).json();
}
/** What the model received and which fixture answered (aimock's journal). */
async function model(request: APIRequestContext) {
  return (await request.get('/__model-requests')).json();
}
async function start(
  page: Page,
  request: APIRequestContext,
  ops?: { edit?: unknown[]; hold?: boolean }
) {
  await request.post('/__reset');
  // Injected data, per test: proxy edits or a hold on the browser's stream.
  if (ops?.edit)
    await request.post('/__stream/edit', { data: { ops: ops.edit } });
  if (ops?.hold)
    await request.post('/__hold/stream', { data: { afterType: 'RUN_STARTED' } });
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await requests(request)).toHaveLength(0);
  await page
    .getByRole('button', { name: 'Reserve the campsite', exact: true })
    .click();
  expect(await requests(request)).toHaveLength(0);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
test.afterEach(async ({ page, request }) => {
  await writeFile(
    test.info().outputPath('private-dom.html'),
    await page.content()
  );
  const evidencePath = test
    .info()
    .outputPath('private-actual-service-evidence.json');
  await writeFile(
    evidencePath,
    JSON.stringify(
      { requests: await requests(request), model: await model(request) },
      null,
      2
    )
  );
  await test.info().attach('private-actual-service-evidence.json', {
    path: evidencePath,
    contentType: 'application/json',
  });
  await request.post('/__release');
});
for (const decision of ['Approve', 'Decline'] as const) {
  test(`actual native ${decision.toLowerCase()} binds pause, resume, tool result and truthful model reply`, async ({
    page,
    request,
  }) => {
    await start(page, request);
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toBeEnabled();
    // The pending approval sits at the end of the transcript.
    await expect(
      page
        .getByRole('region', { name: 'Conversation' })
        .getByRole('region', { name: 'Reservation approval' })
    ).toBeVisible();
    await expect(page.getByText('North Pines', { exact: true })).toBeVisible();
    await expect(page.getByText('$90.00', { exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('approval-desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await expect(page.getByText('$90.00', { exact: true })).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('approval-mobile.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeDisabled();
    await page
      .locator('form')
      .evaluate((form: HTMLFormElement) => form.requestSubmit());
    expect(await requests(request)).toHaveLength(1);
    const before = await requests(request);
    const source = before[0];
    const pause = source.events.find(
      (event: { type: string; name?: string }) => event.type === 'RUN_FINISHED'
    );
    expect(pause.outcome.type).toBe('interrupt');
    expect(pause.outcome.interrupts).toHaveLength(1);
    expect(source.body).toEqual({
      threadId: source.body.threadId,
      runId: source.body.runId,
      protocolVersion: '1.0',
      state: {},
      messages: [
        {
          id: source.body.messages[0].id,
          role: 'user',
          content: 'Please reserve the North Pines campsite for 2 nights.',
        },
      ],
      tools: [],
      context: [],
      forwardedProps: {},
    });
    const interrupt = pause.outcome.interrupts[0];
    const notice = JSON.parse(
      source.events.find(
        (event: { type: string; name?: string }) =>
          event.type === 'CUSTOM' && event.name === 'on_interrupt'
      ).value
    );
    expect(notice.runId).toBe(source.body.runId);
    expect(notice.toolCallId).toBe(interrupt.toolCallId);
    expect(interrupt.reason).toBe('mastra:tool_suspend');
    expect(interrupt.metadata.mastra.suspendPayload).toEqual({
      site: 'North Pines',
      nights: 2,
      total_usd: 90,
    });

    await page
      .getByRole('button', { name: decision, exact: true })
      .evaluate((button: HTMLButtonElement) => {
        button.click();
        button.click();
      });
    await expect(page.getByRole('status')).toHaveText(
      decision === 'Approve'
        ? 'Fictional reservation approved.'
        : 'Reservation declined. Nothing was booked.'
    );
    const literal =
      decision === 'Approve'
        ? 'Reserved North Pines for 2 night(s) — total $90. Confirmation TP-0288.'
        : 'Reservation for North Pines was declined by the user. Nothing was booked.';
    await expect(
      page
        .getByRole('region', { name: 'Observed backend result' })
        .locator('pre')
    ).toHaveText(JSON.stringify(literal));
    await expect(
      page.getByText(
        decision === 'Approve'
          ? 'North Pines is reserved for 2 nights — confirmation TP-0288.'
          : 'The reservation for the North Pines campsite was not booked.',
        { exact: true }
      )
    ).toBeVisible();
    // The answered approval leaves a one-line record, and focus returns to the composer.
    await expect(
      page
        .getByRole('region', { name: 'Conversation' })
        .locator('.tp-approval-record')
    ).toHaveText(decision === 'Approve' ? /^Approved$/ : /^Declined$/);
    await expect(
      page.getByRole('region', { name: 'Reservation approval' })
    ).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeFocused();
    const records = await requests(request);
    expect(records).toHaveLength(2);
    const resume = records[1].body;
    expect(resume.runId).not.toBe(source.body.runId);
    expect(resume.threadId).toBe(source.body.threadId);
    expect(resume.protocolVersion).toBe('1.0');
    expect(resume.state).toEqual({});
    expect(resume.tools).toEqual([]);
    expect(resume.context).toEqual([]);
    expect(resume.forwardedProps).toEqual({});
    expect(resume.resume).toEqual([
      {
        interruptId: pause.outcome.interrupts[0].id,
        status: 'resolved',
        payload: { approved: decision === 'Approve' },
      },
    ]);
    expect(resume.messages).toEqual(source.body.messages);
    expect(resume).toEqual({
      ...source.body,
      runId: resume.runId,
      resume: [
        {
          interruptId: interrupt.id,
          status: 'resolved',
          payload: { approved: decision === 'Approve' },
        },
      ],
    });
    const results = records[1].events.filter(
      (event: { type: string }) => event.type === 'TOOL_CALL_RESULT'
    );
    expect(results).toHaveLength(1);
    expect(results[0].toolCallId).toBe(interrupt.toolCallId);
    expect(results[0].content).toBe(JSON.stringify(literal));
    const terminal = records[1].events.find(
      (event: { type: string }) => event.type === 'RUN_FINISHED'
    );
    expect(terminal).toMatchObject({
      type: 'RUN_FINISHED',
      threadId: resume.threadId,
      runId: resume.runId,
    });
    expect(terminal.outcome).toBeUndefined();
    // The continuation answered the real tool result: the fixture keyed on
    // the decision's literal answered with text, not another tool call.
    const calls = await model(request);
    expect(calls).toHaveLength(2);
    expect(calls[1].response.fixture.match.toolResultContains).toBe(
      decision === 'Approve' ? 'Reserved North Pines' : 'Nothing was booked.'
    );
    expect(calls[1].response.fixture.response.toolCalls).toBeUndefined();
    expect(records.every((r: { closed: boolean }) => r.closed)).toBe(true);
    await page.screenshot({
      path: test.info().outputPath('desktop.png'),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    ).toBe(true);
    await expect(
      page.getByRole('region', { name: 'Observed backend result' })
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('mobile.png'),
      fullPage: true,
    });
    await page
      .getByRole('button', { name: 'New conversation', exact: true })
      .click();
    await expect(page.getByRole('status')).toHaveText('Ready.');
    expect(await requests(request)).toHaveLength(2);
  });
}
test('informational notice without native terminal grants no decision', async ({
  page,
  request,
}) => {
  // Injected data: the proxy drops the pause's real interrupt terminal.
  await start(page, request, {
    edit: [{ type: 'RUN_FINISHED', op: 'drop' }],
  });
  await expect(page.getByRole('status')).toContainText('unconfirmed');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  const records = await requests(request);
  expect(records).toHaveLength(1);
  // The service streamed its interrupt terminal; the browser never got it.
  expect(
    records[0].events.filter(
      (event: { type: string }) => event.type === 'RUN_FINISHED'
    )
  ).toHaveLength(1);
  expect(
    records[0].sent.some(
      (event: { type: string }) => event.type === 'RUN_FINISHED'
    )
  ).toBe(false);
  expect(
    records[0].sent.some(
      (event: { type: string; name?: string }) =>
        event.type === 'CUSTOM' && event.name === 'on_interrupt'
    )
  ).toBe(true);
});
test('accepted resume with actual result but lost root terminal cannot retry', async ({
  page,
  request,
}) => {
  await start(page, request);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  // Injected data: the proxy drops the resumed run's real root terminal.
  await request.post('/__stream/edit', {
    data: { ops: [{ type: 'RUN_FINISHED', op: 'drop' }] },
  });
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('unconfirmed');
  await expect(
    page.getByRole('button', { name: 'Send', exact: true })
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  const records = await requests(request);
  expect(records).toHaveLength(2);
  expect(
    records[1].events.some(
      (event: { type: string; name?: string }) =>
        event.type === 'TOOL_CALL_RESULT'
    )
  ).toBe(true);
  expect(
    records[1].sent.some(
      (event: { type: string }) => event.type === 'RUN_FINISHED'
    )
  ).toBe(false);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  expect(await requests(request)).toHaveLength(2);
});
for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`active ${action} closes actual transport without resume`, async ({
    page,
    request,
  }) => {
    // Injected data: the proxy holds the browser's stream after RUN_STARTED.
    await start(page, request, { hold: true });
    await expect
      .poll(async () => (await requests(request))[0]?.held)
      .toBe(true);
    if (action === 'unmount') await page.goto('about:blank');
    else await page.getByRole('button', { name: action, exact: true }).click();
    await expect
      .poll(async () => (await requests(request))[0].closed)
      .toBe(true);
    const records = await requests(request);
    expect(records).toHaveLength(1);
    expect(records[0].body.resume).toBeUndefined();
    expect(
      records[0].sent.some(
        (event: { type: string; name?: string }) =>
          event.type === 'RUN_FINISHED'
      )
    ).toBe(false);
  });
test('New from paused reservation revokes stale decision without request', async ({
  page,
  request,
}) => {
  await start(page, request);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  expect(await requests(request)).toHaveLength(1);
});
