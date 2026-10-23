/* eslint-disable @typescript-eslint/no-non-null-assertion -- Raw native fixture presence is asserted before use. */
import {
  test,
  expect,
  type Page,
  type APIRequestContext,
  type Locator,
} from '@playwright/test';
import { writeFile } from 'node:fs/promises';
const path = '/runtimes/aws-strands/react/';
const literal = (approved: boolean) =>
  approved
    ? 'Meeting booked for Tuesday 10:00: Q3 roadmap review'
    : 'The human declined. Meeting NOT booked: Q3 roadmap review';
interface Wire {
  type: string;
  threadId?: string;
  runId?: string;
  subagentRunId?: string;
  toolCallId?: string;
  content?: string;
  outcome?: {
    type: string;
    interrupts?: { id: string; reason: string; metadata: unknown }[];
  };
  messages?: {
    id: string;
    role: string;
    toolCallId?: string;
    content?: string;
    subagentRunId?: string;
    toolCalls?: { id: string; function: { name: string; arguments: string } }[];
  }[];
}
function events(base64: string): Wire[] {
  return [
    ...Buffer.from(base64, 'base64')
      .toString()
      .matchAll(/^data: (.+)$/gm),
  ].map((m) => JSON.parse(m[1]));
}
async function stats(request: APIRequestContext) {
  return (await request.get('/__stats')).json();
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
    .getByRole('button', { name: 'Q3 roadmap review', exact: true })
    .click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function withinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((e) => {
      const r = e.getBoundingClientRect();
      return (
        r.left >= 0 &&
        r.right <= innerWidth + 1 &&
        r.top >= 0 &&
        r.bottom <= innerHeight + 1 &&
        e.scrollWidth <= e.clientWidth + 1
      );
    })
  ).toBe(true);
}
test.afterEach(async ({ page, request }) => {
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
test('mount, editable preset and New remain lazy until explicit Send', async ({
  page,
  request,
}) => {
  await start(page, request);
  await page
    .getByRole('button', { name: 'Q3 roadmap review', exact: true })
    .click();
  await page
    .getByRole('textbox', { name: 'Message', exact: true })
    .fill('Edited fictional meeting request');
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(
    page.getByRole('textbox', { name: 'Message', exact: true })
  ).toHaveValue('');
  expect((await stats(request)).current.requests).toHaveLength(0);
  expect((await stats(request)).current.observed.model.httpSeen).toBe(0);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  expect((await stats(request)).current.requests).toHaveLength(1);
});
for (const scenario of ['approval', 'batch'])
  for (const width of [1280, 390])
    for (const decision of ['Approve', 'Decline'] as const)
      test(`genuine ${scenario} ${decision} ${width}: canonical decision/result and truthful observed snapshot`, async ({
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
        const card = page.getByRole('region', { name: 'Meeting approval' }),
          observed = page.getByRole('region', {
            name: 'Last observed schedule',
          });
        await expect(card).toContainText('Q3 roadmap review');
        await expect(card).toContainText('Tuesday 10:00');
        await expect(observed).toContainText(
          'Observed booking status: pending'
        );
        await expect(observed).toContainText(
          scenario === 'batch'
            ? 'No availability observed yet.'
            : '10:00, 15:00'
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
        for (const c of [
          page.getByRole('button', { name: 'Approve', exact: true }),
          page.getByRole('button', { name: 'Decline', exact: true }),
          page.getByRole('button', { name: 'New conversation', exact: true }),
          page.getByRole('textbox', { name: 'Message', exact: true }),
          page.getByRole('status'),
        ])
          await withinViewport(c);
        await card.screenshot({
          path: test.info().outputPath('canonical-approval-card.png'),
        });
        const before = await stats(request),
          initial = before.current.requests[0],
          terminal = events(initial.upstreamBase64).find(
            (e) => e.type === 'RUN_FINISHED'
          );
        expect(before.current.requests).toHaveLength(1);
        expect(initial.upstreamBase64).toBe(initial.sentBase64);
        expect(terminal?.threadId).toBe(initial.body.threadId);
        expect(terminal?.runId).toBe(initial.body.runId);
        expect(terminal?.outcome?.type).toBe('interrupt');
        expect(terminal?.outcome?.interrupts).toHaveLength(1);
        expect(terminal?.outcome?.interrupts?.[0].reason).toBe('book_meeting');
        const pauseRows = events(initial.upstreamBase64)
          .filter((e) => e.type === 'MESSAGES_SNAPSHOT')
          .at(-1)?.messages;
        expect(pauseRows).toBeDefined();
        const calls = pauseRows!.flatMap((m) => m.toolCalls ?? []);
        const book = calls.find((c) => c.function.name === 'book_meeting')!,
          lookup = calls.find((c) => c.function.name === 'check_availability')!;
        expect(book).toBeDefined();
        expect(JSON.parse(book.function.arguments)).toEqual({
          topic: 'Q3 roadmap review',
          slot: 'Tuesday 10:00',
        });
        expect(pauseRows!.filter((m) => m.role === 'tool')).toHaveLength(
          scenario === 'batch' ? 0 : 1
        );
        expect(before.current.observed.completedReturns).toHaveLength(0);
        expect(before.current.observed.interruptedUnwinds).toBe(1);
        // Two synchronous DOM clicks simulate competing choices before a rerender; only the native owner may claim once.
        await page
          .getByRole('button', { name: decision, exact: true })
          .evaluate((e) => {
            (e as HTMLButtonElement).click();
            (e as HTMLButtonElement).click();
          });
        await expect(page.getByRole('status')).toHaveText(
          decision === 'Approve'
            ? 'Fictional meeting booked.'
            : 'Meeting declined.'
        );
        const result = page.getByRole('region', {
          name: 'Observed backend result',
        });
        await expect(result.locator('pre')).toHaveText(
          literal(decision === 'Approve')
        );
        await expect(
          page.getByRole('region', { name: 'Conversation' })
        ).toContainText('The Q3 roadmap review booking decision is complete.');
        await expect(observed).toContainText(
          `Observed booking status: ${
            scenario === 'approval'
              ? 'pending'
              : decision === 'Approve'
              ? 'booked'
              : 'declined'
          }`
        );
        await expect(
          page.getByRole('button', { name: 'Approve', exact: true })
        ).toHaveCount(0);
        await page.screenshot({
          path: test.info().outputPath('complete-result.png'),
          fullPage: true,
        });
        for (const c of [
          result.locator('pre'),
          page.getByRole('button', { name: 'Send', exact: true }),
          page.getByRole('textbox', { name: 'Message', exact: true }),
          page.getByRole('status'),
        ])
          await withinViewport(c);
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
        const final = events(records[1].upstreamBase64),
          end = final.find((e) => e.type === 'RUN_FINISHED');
        expect(end?.threadId).toBe(initial.body.threadId);
        expect(end?.runId).toBe(records[1].body.runId);
        expect(end?.subagentRunId).toBeUndefined();
        expect(end?.outcome?.type).toBe('success');
        const rows = final
          .filter((e) => e.type === 'MESSAGES_SNAPSHOT')
          .at(-1)?.messages;
        expect(rows).toBeDefined();
        for (const call of [book, lookup]) {
          const found = rows!.filter(
            (m) => m.role === 'tool' && m.toolCallId === call.id
          );
          expect(found).toHaveLength(1);
          expect(found[0].subagentRunId).toBeUndefined();
          if (call === book)
            expect(found[0].content).toBe(
              JSON.stringify(literal(decision === 'Approve'))
            );
          const provider = after.current.observed.model.records
            .at(-1)
            .body.messages.filter(
              (m: { role: string; tool_call_id?: string }) =>
                m.role === 'tool' && m.tool_call_id === call.id
            );
          expect(provider).toHaveLength(1);
          if (call === book) {
            expect(provider[0].content).toBe(literal(decision === 'Approve'));
          } else {
            // Provider JSON and AG-UI JSON have different whitespace serialization.
            expect(JSON.parse(provider[0].content)).toEqual(
              JSON.parse(found[0].content!)
            );
          }
        }
        expect(after.current.observed.model.httpSeen).toBe(
          scenario === 'batch' ? 2 : 3
        );
        expect(
          after.current.observed.model.records.at(-1).canonicalContinuation
        ).toBe(literal(decision === 'Approve'));
        expect(after.current.observed.completedReturns).toHaveLength(1);
        expect(after.current.observed.backendState.booking.status).toBe(
          decision === 'Approve' ? 'booked' : 'declined'
        );
        expect(after.current.observed.observedState.booking.status).toBe(
          scenario === 'approval'
            ? 'pending'
            : decision === 'Approve'
            ? 'booked'
            : 'declined'
        );
        expect(
          after.current.observed.model.records.every(
            (r: { requestHeaders: string[][] }) =>
              r.requestHeaders.some(
                ([k, v]) =>
                  k.toLowerCase() === 'x-stainless-retry-count' && v === '0'
              )
          )
        ).toBe(true);
      });
for (const scenario of [
  'missing-terminal',
  'wrong-terminal',
  'child-only-terminal',
])
  test(`negative ${scenario} cannot confirm genuine booking result`, async ({
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
      'Meeting unconfirmed. Start a new conversation.'
    );
    await expect(
      page.getByRole('region', { name: 'Observed backend result' })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: 'Send', exact: true })
    ).toBeDisabled();
    const evidence = await stats(request),
      resumed = evidence.current.requests[1];
    expect(evidence.current.requests).toHaveLength(2);
    expect(
      events(resumed.upstreamBase64).some(
        (e) => e.type === 'RUN_FINISHED' && e.runId === resumed.body.runId
      )
    ).toBe(true);
    expect(
      events(resumed.sentBase64).some(
        (e) => e.type === 'RUN_FINISHED' && e.runId === resumed.body.runId
      )
    ).toBe(false);
    expect(evidence.current.observed.completedReturns).toHaveLength(1);
  });
for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`held genuine model ${action} closes actual peer before cleanup`, async ({
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
    expect(evidence.current.observed.model.records[0].cleanupReleased).toBe(
      false
    );
    expect(evidence.current.observed.completedReturns).toHaveLength(0);
  });
test('paused New removes authority and only explicit Send allocates fresh thread', async ({
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
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  const after = await stats(request);
  expect(after.current.requests).toHaveLength(2);
  expect(after.current.requests[1].body.threadId).not.toBe(
    before.current.requests[0].body.threadId
  );
  expect(after.current.observed.completedReturns).toHaveLength(0);
});
test('two completed explicit turns retain prior canonicals in the same Session', async ({
  page,
  request,
}) => {
  await start(page, request);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText(
    'Fictional meeting booked.'
  );
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Decline', exact: true })
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByRole('status')).toHaveText('Meeting declined.');
  const evidence = await stats(request),
    requests = evidence.current.requests;
  expect(requests).toHaveLength(4);
  expect(
    new Set(
      requests.map((r: { body: { threadId: string } }) => r.body.threadId)
    ).size
  ).toBe(1);
  expect(evidence.current.observed.completedReturns).toHaveLength(2);
  expect(evidence.current.observed.model.httpSeen).toBe(6);
  expect(
    requests[2].body.messages.filter((m: { role: string }) => m.role === 'tool')
  ).toHaveLength(2);
});
