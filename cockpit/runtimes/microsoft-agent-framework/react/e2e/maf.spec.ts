import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type Locator,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const path = '/runtimes/microsoft-agent-framework/react/';
const approved =
  'Expense recorded: $220.00 to Blue Finch Bistro (meals) — queued for reimbursement.';
const rejected = 'Error: Tool call invocation was rejected by user.';
async function stats(request: APIRequestContext) {
  return (await request.get('/__stats')).json();
}
interface WireEvent {
  readonly type: string;
  readonly runId?: string;
  readonly threadId?: string;
  readonly subagentRunId?: string;
  readonly messages?: readonly WireMessage[];
  readonly outcome?: {
    readonly type: string;
    readonly interrupts?: readonly { readonly id: string }[];
  };
}
interface WireMessage {
  readonly id: string;
  readonly role: string;
  readonly content?: string;
  readonly toolCallId?: string;
  readonly subagentRunId?: string;
  readonly error?: boolean;
  readonly toolCalls?: readonly {
    readonly id: string;
    readonly function: { readonly name: string; readonly arguments: string };
  }[];
}
function events(base64: string): WireEvent[] {
  return [
    ...Buffer.from(base64, 'base64')
      .toString()
      .matchAll(/^data: (.+)$/gm),
  ].map((match) => JSON.parse(match[1]));
}
async function start(
  page: Page,
  request: APIRequestContext,
  scenario = 'approval'
) {
  expect((await request.post('/__reset', { data: { scenario } })).ok()).toBe(
    true
  );
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Ready.');
}
async function send(page: Page) {
  await page
    .getByRole('button', { name: 'Team dinner for 4', exact: true })
    .click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function withinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return (
        rect.left >= 0 &&
        rect.right <= innerWidth + 1 &&
        rect.top >= 0 &&
        rect.bottom <= innerHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    })
  ).toBe(true);
}
test.afterEach(async ({ page, request }) => {
  // Capture failure attempts too; stats are assertions, never application input.
  await writeFile(
    test.info().outputPath('actual-service-evidence.json'),
    JSON.stringify(await stats(request), null, 2)
  );
  await writeFile(test.info().outputPath('dom.html'), await page.content());
  const receipt = await (await request.post('/__finish')).json();
  await writeFile(
    test.info().outputPath('owned-cleanup.json'),
    JSON.stringify(receipt, null, 2)
  );
  for (const owner of receipt.closed)
    expect(Object.values(owner.closure).every(Boolean)).toBe(true);
});

test('mount, preset, edit and New allocate no requests; only explicit Send reaches service', async ({
  page,
  request,
}) => {
  await start(page, request);
  await page
    .getByRole('button', { name: 'Team dinner for 4', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Edited fictional Blue Finch Bistro request');
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true })
  ).toHaveValue('');
  let evidence = await stats(request);
  expect(evidence.current.requests).toHaveLength(0);
  expect(evidence.current.observed.model.httpSeen).toBe(0);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  evidence = await stats(request);
  expect(evidence.current.requests).toHaveLength(1);
  expect(evidence.current.observed.model.httpSeen).toBe(2);
});

for (const scenario of ['approval', 'batch'])
  for (const width of [1280, 390])
    for (const decision of ['Approve', 'Decline'] as const) {
      test(`actual native ${scenario} ${decision} at ${width} binds original pause, typed model continuation and literal result`, async ({
        page,
        request,
      }) => {
        await page.setViewportSize({
          width,
          height: width === 390 ? 844 : 900,
        });
        await start(page, request, scenario);
        await send(page);
        await expect(page.getByRole('status')).toHaveText(
          'Awaiting your decision.'
        );
        await expect(
          page.getByRole('button', { name: 'Approve', exact: true })
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Decline', exact: true })
        ).toBeEnabled();
        const draft = page.getByRole('region', {
          name: 'Predictive expense draft',
        });
        await expect(draft).toContainText('Blue Finch Bistro');
        await expect(draft).toContainText('meals');
        await expect(draft).toContainText('$220.00');
        await expect(draft).toContainText(
          'Team dinner for 4 attendees; receipt attached.'
        );
        await expect(
          page.getByRole('textbox', { name: 'Message', exact: true })
        ).toBeDisabled();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        ).toBe(true);
        await page.screenshot({
          path: test.info().outputPath('complete-approval.png'),
          fullPage: true,
        });
        const card = page.locator('.tp-approval-card');
        await expect(card).toContainText('Blue Finch Bistro');
        await expect(card).toContainText('$220.00');
        for (const control of [
          page.getByRole('button', { name: 'Approve', exact: true }),
          page.getByRole('button', { name: 'Decline', exact: true }),
          page.getByRole('button', { name: 'New conversation', exact: true }),
          page.getByRole('textbox', { name: 'Message', exact: true }),
          page.getByRole('status'),
        ])
          await withinViewport(control);
        expect(
          await card.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return (
              rect.left >= 0 &&
              rect.right <= innerWidth &&
              element.scrollWidth <= element.clientWidth + 1
            );
          })
        ).toBe(true);
        await card.screenshot({
          path: test.info().outputPath('canonical-approval-card.png'),
        });
        const before = await stats(request);
        expect(before.current.requests).toHaveLength(1);
        const initial = before.current.requests[0];
        expect(initial.upstreamBase64).toBe(initial.sentBase64);
        const terminal = events(initial.upstreamBase64).find(
          (event) => event.type === 'RUN_FINISHED'
        );
        expect(terminal?.runId).toBe(initial.body.runId);
        expect(terminal?.threadId).toBe(initial.body.threadId);
        expect(terminal?.outcome?.type).toBe('interrupt');
        expect(terminal?.outcome?.interrupts).toHaveLength(1);
        if (scenario === 'batch') {
          expect(before.current.observed.model.httpSeen).toBe(1);
          const response = Buffer.from(
            before.current.observed.model.records[0].responseBase64,
            'base64'
          ).toString();
          const declarations = [
            ...response.matchAll(/^data: (\{.+\})$/gm),
          ].flatMap(
            (match) => JSON.parse(match[1]).choices[0].delta.tool_calls ?? []
          );
          expect(
            declarations.map((call) => [call.id, call.function.name])
          ).toEqual([
            ['c0_lookup_expense_policy', 'lookup_expense_policy'],
            ['c0_submit_expense', 'submit_expense'],
          ]);
          const pausedRows = events(initial.upstreamBase64)
            .filter((event) => event.type === 'MESSAGES_SNAPSHOT')
            .at(-1)?.messages;
          expect(pausedRows).toBeDefined();
          const assistant = pausedRows?.filter(
            (message) =>
              message.role === 'assistant' && message.toolCalls?.length
          );
          expect(assistant).toHaveLength(1);
          expect(
            assistant?.[0].toolCalls?.map((call) => [
              call.id,
              call.function.name,
              JSON.parse(call.function.arguments),
            ])
          ).toEqual(
            declarations.map((call) => [
              call.id,
              call.function.name,
              JSON.parse(call.function.arguments),
            ])
          );
          expect(
            pausedRows?.filter((message) => message.role === 'tool')
          ).toHaveLength(0);
        }
        expect(before.current.observed.entries).toBe(0);
        await page.getByRole('button', { name: decision, exact: true }).click();
        await expect(page.getByRole('status')).toHaveText(
          decision === 'Approve'
            ? 'Fictional expense approved.'
            : 'Expense declined.'
        );
        const result = page.getByRole('region', {
          name: 'Observed backend result',
        });
        await expect(result.locator('pre')).toHaveText(
          decision === 'Approve' ? approved : rejected
        );
        await expect(
          page.getByRole('textbox', { name: 'Message', exact: true })
        ).toBeEnabled();
        await expect(
          page.getByRole('button', { name: 'Approve', exact: true })
        ).toHaveCount(0);
        await page.screenshot({
          path: test.info().outputPath('complete-result.png'),
          fullPage: true,
        });
        for (const control of [
          result.locator('pre'),
          page.getByRole('textbox', { name: 'Message', exact: true }),
          page.getByRole('button', { name: 'Send', exact: true }),
          page.getByRole('button', { name: 'New conversation', exact: true }),
          page.getByRole('status'),
        ])
          await withinViewport(control);
        await result.screenshot({
          path: test.info().outputPath('literal-result-region.png'),
        });
        const after = await stats(request),
          records = after.current.requests;
        expect(records).toHaveLength(2);
        expect(records[1].upstreamBase64).toBe(records[1].sentBase64);
        expect(records[1].body.threadId).toBe(initial.body.threadId);
        expect(records[1].body.runId).not.toBe(initial.body.runId);
        expect(records[1].body.resume).toEqual([
          {
            interruptId: terminal?.outcome?.interrupts?.[0].id,
            status: 'resolved',
            payload: { approved: decision === 'Approve' },
          },
        ]);
        const final = events(records[1].upstreamBase64).find(
          (event) => event.type === 'RUN_FINISHED'
        );
        expect(final?.runId).toBe(records[1].body.runId);
        expect(final?.threadId).toBe(records[1].body.threadId);
        expect(final?.subagentRunId).toBeUndefined();
        if (scenario === 'batch') {
          const finalRows = events(records[1].upstreamBase64)
            .filter((event) => event.type === 'MESSAGES_SNAPSHOT')
            .at(-1)?.messages;
          expect(finalRows).toBeDefined();
          for (const callId of [
            'c0_lookup_expense_policy',
            'c0_submit_expense',
          ]) {
            const results = finalRows?.filter(
              (message) =>
                message.role === 'tool' && message.toolCallId === callId
            );
            expect(results).toHaveLength(1);
            expect(results?.[0].subagentRunId).toBeUndefined();
            expect(results?.[0].error).toBeFalsy();
            expect(results?.[0].content?.trim()).toBeTruthy();
            if (callId === 'c0_submit_expense')
              expect(results?.[0].content).toBe(
                decision === 'Approve' ? approved : rejected
              );
            // The lookup is compared with the genuine continuation, never used as expense authority.
            expect(
              after.current.observed.model.records
                .at(-1)
                .body.messages.filter(
                  (message: { role: string; tool_call_id?: string }) =>
                    message.role === 'tool' && message.tool_call_id === callId
                )
                .map((message: { content: string }) => message.content)
            ).toEqual([results?.[0].content]);
          }
          expect(
            records[1].body.messages.filter(
              (message: WireMessage) => message.role === 'tool'
            )
          ).toHaveLength(0);
        }
        expect(after.current.observed.model.httpSeen).toBe(
          scenario === 'batch' ? 2 : 3
        );
        expect(
          after.current.observed.model.records.map(
            (record: Record<string, unknown>) => record.branch
          )
        ).toEqual([
          ...(scenario === 'batch'
            ? ['batch-policy-submit']
            : ['lookup-policy', 'submit-expense']),
          decision === 'Approve'
            ? 'continuation-approve'
            : 'continuation-decline',
        ]);
        expect(
          after.current.observed.model.records.at(-1)
            .actualContinuationToolContent
        ).toBe(decision === 'Approve' ? approved : rejected);
        expect(after.current.observed.entries).toBe(
          decision === 'Approve' ? 1 : 0
        );
      });
    }

for (const scenario of ['missing-terminal', 'wrong-terminal'])
  test(`negative-only ${scenario} leaves actual result unconfirmed`, async ({
    page,
    request,
  }) => {
    await start(page, request, scenario);
    await send(page);
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toBeEnabled();
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Expense unconfirmed. Start a new conversation.'
    );
    await expect(
      page.getByRole('region', { name: 'Observed backend result' })
    ).toHaveCount(0);
    const evidence = await stats(request),
      resumed = evidence.current.requests[1];
    expect(evidence.current.requests).toHaveLength(2);
    expect(
      events(resumed.upstreamBase64).some(
        (event) =>
          event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId
      )
    ).toBe(true);
    expect(
      events(resumed.sentBase64).some(
        (event) =>
          event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId
      )
    ).toBe(false);
    expect(evidence.current.observed.entries).toBe(1);
  });

for (const scenario of ['draft-only', 'child-pause'])
  test(`negative-only ${scenario} corruption cannot authorize an approval (child is orphan protocol rejection)`, async ({
    page,
    request,
  }) => {
    await start(page, request, scenario);
    await send(page);
    await expect(page.getByRole('status')).toHaveText(
      'Expense unconfirmed. Start a new conversation.'
    );
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    const evidence = await stats(request);
    expect(evidence.current.requests).toHaveLength(1);
    expect(evidence.current.observed.entries).toBe(0);
    expect(evidence.current.observed.model.httpSeen).toBe(2);
    expect(evidence.current.requests[0].upstreamBase64).not.toBe(
      evidence.current.requests[0].sentBase64
    );
  });

for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`held actual model ${action} closes peer before fixture cleanup`, async ({
    page,
    request,
  }) => {
    await start(page, request, 'cancel');
    await send(page);
    await expect
      .poll(
        async () => (await stats(request)).current.observed.model.heldActive
      )
      .toBe(1);
    if (action === 'unmount')
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    else await page.getByRole('button', { name: action, exact: true }).click();
    await expect
      .poll(
        async () => (await stats(request)).current.observed.model.heldActive
      )
      .toBe(0);
    const evidence = await stats(request);
    expect(evidence.current.requests).toHaveLength(1);
    expect(evidence.current.observed.model.httpSeen).toBe(1);
    expect(evidence.current.observed.model.records[0].peerClosed).toBe(true);
    expect(
      evidence.current.observed.model.records[0].heldReleasedByCleanup
    ).toBe(false);
    expect(evidence.current.observed.entries).toBe(0);
  });

test('paused New discards authority without replay; second explicit Send owns a fresh thread', async ({
  page,
  request,
}) => {
  await start(page, request);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  const before = await stats(request);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  expect((await stats(request)).current.requests).toHaveLength(1);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Decline', exact: true })
  ).toBeEnabled();
  const after = await stats(request);
  expect(after.current.requests).toHaveLength(2);
  expect(after.current.requests[1].body.threadId).not.toBe(
    before.current.requests[0].body.threadId
  );
  expect(after.current.observed.model.httpSeen).toBe(4);
  expect(after.current.observed.entries).toBe(0);
});
