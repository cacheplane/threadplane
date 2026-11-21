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
  snapshot?: unknown;
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
// Backend: aimock replays cockpit/runtimes/aws-strands/angular/e2e/fixtures
// (the meeting model's answers, keyed on the React preset prompt) into the
// example's real Strands AG-UI server, behind the recording proxy
// (scripts/react-cockpit/ag-ui-proxy.mjs). Scenarios are tags the spec
// appends to the preset (`[scenario:batch]`, `[scenario:cancel]`).
/** Every agent POST: { body, events (real), sent (to the browser), closed }. */
interface Run {
  body: {
    threadId: string;
    runId: string;
    resume?: unknown;
    messages: { role: string }[];
  };
  events: Wire[];
  sent: Wire[];
  closed: boolean;
}
async function runs(request: APIRequestContext): Promise<Run[]> {
  return (await request.get('/__requests')).json();
}
/** What the model received (aimock's request journal). */
interface ModelCall {
  headers: Record<string, string>;
  body: {
    messages: { role: string; tool_call_id?: string; content?: string }[];
  };
  response: { status: number; interrupted?: boolean };
}
async function model(request: APIRequestContext): Promise<ModelCall[]> {
  return (await request.get('/__model-requests')).json();
}
async function start(page: Page, request: APIRequestContext) {
  expect((await request.post('/__reset')).ok()).toBe(true);
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Ready.');
}
async function send(page: Page, scenario = 'approval') {
  await page
    .getByRole('button', { name: 'Q3 roadmap review', exact: true })
    .click();
  if (scenario !== 'approval')
    await page
      .getByRole('textbox', { name: 'Message', exact: true })
      .press('End')
      .then(() =>
        page
          .getByRole('textbox', { name: 'Message', exact: true })
          .pressSequentially(` [scenario:${scenario}]`)
      );
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
    JSON.stringify(
      { runs: await runs(request), model: await model(request) },
      null,
      2
    )
  );
  await writeFile(test.info().outputPath('dom.html'), await page.content());
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
  expect(await runs(request)).toHaveLength(0);
  expect(await model(request)).toHaveLength(0);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  expect(await runs(request)).toHaveLength(1);
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
        await start(page, request);
        await send(page, scenario);
        await expect(page.getByRole('status')).toHaveText(
          'Awaiting your decision.'
        );
        // The pending approval sits at the end of the transcript.
        await expect(
          page
            .getByRole('region', { name: 'Conversation' })
            .getByRole('region', { name: 'Meeting approval' })
        ).toBeVisible();
        const card = page.getByRole('region', { name: 'Meeting approval' }),
          observed = page.getByRole('region', {
            name: 'Last observed schedule',
          });
        await expect(card).toContainText('Q3 roadmap review');
        await expect(card).toContainText('Tuesday 10:00');
        await expect(observed).toContainText(
          'Observed booking status: pending'
        );
        // The panel shows the last snapshot the server sent. Approval looked
        // availability up in this run; a batch pauses before its lookup
        // result, so its snapshot carries whatever availability the server's
        // per-process demo state already held (src/agent.py keeps one state
        // for the whole process).
        const snapshot = (await runs(request))[0].events
          .filter((e) => e.type === 'STATE_SNAPSHOT')
          .at(-1)?.snapshot as
          | { availability: { slots: string[] } | null }
          | undefined;
        if (scenario === 'approval')
          expect(snapshot?.availability?.slots).toEqual(['10:00', '15:00']);
        await expect(observed).toContainText(
          snapshot?.availability
            ? snapshot.availability.slots.join(', ')
            : 'No availability observed yet.'
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
        const before = await runs(request),
          initial = before[0],
          terminal = initial.events.find((e) => e.type === 'RUN_FINISHED');
        expect(before).toHaveLength(1);
        // The browser got exactly what the real server streamed.
        expect(initial.sent).toEqual(initial.events);
        expect(terminal?.threadId).toBe(initial.body.threadId);
        expect(terminal?.runId).toBe(initial.body.runId);
        expect(terminal?.outcome?.type).toBe('interrupt');
        expect(terminal?.outcome?.interrupts).toHaveLength(1);
        expect(terminal?.outcome?.interrupts?.[0].reason).toBe('book_meeting');
        const pauseRows = initial.events
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
        // Paused: the booking tool has not returned a result yet.
        expect(
          initial.events.some(
            (e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId === book.id
          )
        ).toBe(false);
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
        // The answered approval leaves a one-line record, and focus returns to the composer.
        await expect(
          page
            .getByRole('region', { name: 'Conversation' })
            .locator('.tp-approval-record')
        ).toHaveText(decision === 'Approve' ? /^Approved$/ : /^Declined$/);
        await expect(
          page.getByRole('textbox', { name: 'Message', exact: true })
        ).toBeFocused();
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
        const records = await runs(request),
          calls_ = await model(request);
        expect(records).toHaveLength(2);
        expect(records[1].sent).toEqual(records[1].events);
        expect(records[1].body.threadId).toBe(initial.body.threadId);
        expect(records[1].body.runId).not.toBe(initial.body.runId);
        expect(records[1].body.resume).toEqual([
          {
            interruptId: terminal?.outcome?.interrupts?.[0].id,
            status: 'resolved',
            payload: { approved: decision === 'Approve' },
          },
        ]);
        const final = records[1].events,
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
          const provider = calls_
            .at(-1)!
            .body.messages.filter(
              (m) => m.role === 'tool' && m.tool_call_id === call.id
            );
          expect(provider).toHaveLength(1);
          if (call === book) {
            expect(provider[0].content).toBe(literal(decision === 'Approve'));
          } else {
            // Provider JSON and AG-UI JSON have different whitespace serialization.
            expect(JSON.parse(provider[0].content!)).toEqual(
              JSON.parse(found[0].content!)
            );
          }
        }
        expect(calls_).toHaveLength(scenario === 'batch' ? 2 : 3);
        // The booking tool returned exactly once, with the decision's literal.
        expect(
          final.filter(
            (e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId === book.id
          )
        ).toHaveLength(1);
        // No provider retries.
        expect(
          calls_.every(
            (r) => r.headers['x-stainless-retry-count'] === '0'
          )
        ).toBe(true);
      });
const corruptions: Record<string, unknown[]> = {
  'missing-terminal': [{ type: 'RUN_FINISHED', op: 'drop' }],
  'wrong-terminal': [
    { type: 'RUN_FINISHED', op: 'patch', set: { runId: 'negative-wrong-run' } },
  ],
  'child-only-terminal': [
    {
      type: 'RUN_FINISHED',
      op: 'patch',
      set: {
        type: 'SUBAGENT_FINISHED',
        subagentRunId: 'negative-child',
        outcome: { type: 'suspended' },
      },
    },
    { type: 'RUN_FINISHED', op: 'omit', keys: ['runId', 'threadId'] },
  ],
};
for (const scenario of Object.keys(corruptions))
  test(`negative ${scenario} cannot confirm genuine booking result`, async ({
    page,
    request,
  }) => {
    await start(page, request);
    await send(page);
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toBeEnabled();
    // Injected data: the proxy corrupts the resumed run's real terminal on
    // its way to the browser (dropped, another run's id, or a child-only
    // terminal); the real server still finishes the run.
    expect(
      (
        await request.post('/__stream/edit', {
          data: { ops: corruptions[scenario] },
        })
      ).ok()
    ).toBe(true);
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
    const evidence = await runs(request),
      resumed = evidence[1];
    expect(evidence).toHaveLength(2);
    expect(
      resumed.events.some(
        (e) => e.type === 'RUN_FINISHED' && e.runId === resumed.body.runId
      )
    ).toBe(true);
    expect(
      resumed.sent.some(
        (e) => e.type === 'RUN_FINISHED' && e.runId === resumed.body.runId
      )
    ).toBe(false);
    // The real booking still completed upstream.
    expect(
      resumed.events.some(
        (e) =>
          e.type === 'TOOL_CALL_RESULT' &&
          e.content === JSON.stringify(literal(true))
      )
    ).toBe(true);
  });
for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`held genuine model ${action} closes the run before cleanup`, async ({
    page,
    request,
  }) => {
    // The cancel fixture answers only after 30 s, so the model call is in
    // flight when the browser acts.
    await start(page, request);
    await send(page, 'cancel');
    await expect.poll(async () => (await model(request)).length).toBe(1);
    if (action === 'unmount')
      await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    else await page.getByRole('button', { name: action, exact: true }).click();
    // The browser's run stream is closed; no second run starts.
    await expect.poll(async () => (await runs(request))[0]?.closed).toBe(true);
    const evidence = await runs(request);
    expect(evidence).toHaveLength(1);
    expect(await model(request)).toHaveLength(1);
    expect(
      evidence[0].sent.some((e) => e.type === 'TOOL_CALL_RESULT')
    ).toBe(false);
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
  const before = await runs(request);
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await expect(page.getByRole('status')).toHaveText('Ready.');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  expect(await runs(request)).toHaveLength(1);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  const after = await runs(request);
  expect(after).toHaveLength(2);
  expect(after[1].body.threadId).not.toBe(before[0].body.threadId);
  // Neither paused booking ever returned.
  expect(
    after.flatMap((r) => r.events).some((e) => e.type === 'TOOL_CALL_RESULT' && /booked/i.test(e.content ?? ''))
  ).toBe(false);
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
  const requests = await runs(request);
  expect(requests).toHaveLength(4);
  expect(new Set(requests.map((r) => r.body.threadId)).size).toBe(1);
  // Each resumed run returned its booking result once.
  for (const resumed of [requests[1], requests[3]])
    expect(
      resumed.events.filter(
        (e) =>
          e.type === 'TOOL_CALL_RESULT' && /booked/i.test(e.content ?? '')
      )
    ).toHaveLength(1);
  expect(await model(request)).toHaveLength(6);
  expect(
    requests[2].body.messages.filter((m) => m.role === 'tool')
  ).toHaveLength(2);
});
