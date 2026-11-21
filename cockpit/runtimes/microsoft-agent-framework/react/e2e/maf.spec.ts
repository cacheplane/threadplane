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
// Backend: aimock replays cockpit/runtimes/microsoft-agent-framework/angular/
// e2e/fixtures (the expense model's answers, keyed on the React preset prompt)
// into the example's real Agent Framework AG-UI server, behind the recording
// proxy (scripts/react-cockpit/ag-ui-proxy.mjs). Scenarios are tags the spec
// appends to the preset (`[scenario:batch]`, `[scenario:cancel]`).
interface Run {
  body: {
    threadId: string;
    runId: string;
    resume?: unknown;
    messages: WireMessage[];
  };
  events: WireEvent[];
  sent: WireEvent[];
  closed: boolean;
}
/** Every agent POST: what the server streamed (`events`) and the browser got (`sent`). */
async function runs(request: APIRequestContext): Promise<Run[]> {
  return (await request.get('/__requests')).json();
}
interface ModelCall {
  body: {
    messages: { role: string; tool_call_id?: string; content?: string }[];
  };
  response: {
    fixture: {
      response: {
        content?: string;
        toolCalls?: { id: string; name: string; arguments: string }[];
      };
    } | null;
  };
}
/** What the model received and which fixture answered (aimock's journal). */
async function model(request: APIRequestContext): Promise<ModelCall[]> {
  return (await request.get('/__model-requests')).json();
}
/** The tool calls (or the text) each model call answered with. */
const answers = (calls: ModelCall[]) =>
  calls.map((call) =>
    call.response.fixture?.response.toolCalls?.map((c) => c.name).join('+') ??
    call.response.fixture?.response.content
  );
/** Results of the real submit_expense tool in a run. */
const submitted = (run: Run) =>
  run.events.filter(
    (event) =>
      event.type === 'TOOL_CALL_RESULT' &&
      (event as { toolCallId?: string }).toolCallId === 'c0_submit_expense'
  );
async function start(page: Page, request: APIRequestContext) {
  expect((await request.post('/__reset')).ok()).toBe(true);
  await page.goto(path);
  await expect(page.getByRole('status')).toHaveText('Ready.');
}
async function send(page: Page, scenario = 'approval') {
  await page
    .getByRole('button', { name: 'Team dinner for 4', exact: true })
    .click();
  if (scenario !== 'approval') {
    const box = page.getByRole('textbox', { name: 'Message', exact: true });
    await box.press('End');
    await box.pressSequentially(` [scenario:${scenario}]`);
  }
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
async function withinViewport(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      // Scrolling rounds fractional positions; use the same tolerance on each edge.
      return (
        rect.left >= -1 &&
        rect.right <= innerWidth + 1 &&
        rect.top >= -1 &&
        rect.bottom <= innerHeight + 1 &&
        element.scrollWidth <= element.clientWidth + 1
      );
    })
  ).toBe(true);
}
test.afterEach(async ({ page, request }) => {
  // Capture failure attempts too; evidence is for assertions, never application input.
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
  expect(await runs(request)).toHaveLength(0);
  expect(await model(request)).toHaveLength(0);
  await send(page);
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeEnabled();
  expect(await runs(request)).toHaveLength(1);
  expect(await model(request)).toHaveLength(2);
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
        await start(page, request);
        await send(page, scenario);
        await expect(page.getByRole('status')).toHaveText(
          'Awaiting your decision.'
        );
        // The pending approval sits at the end of the transcript.
        await expect(
          page
            .getByRole('region', { name: 'Conversation' })
            .getByRole('region', { name: 'Expense approval' })
        ).toBeVisible();
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
        const before = await runs(request);
        expect(before).toHaveLength(1);
        const initial = before[0];
        expect(initial.sent).toEqual(initial.events);
        const terminal = initial.events.find(
          (event) => event.type === 'RUN_FINISHED'
        );
        expect(terminal?.runId).toBe(initial.body.runId);
        expect(terminal?.threadId).toBe(initial.body.threadId);
        expect(terminal?.outcome?.type).toBe('interrupt');
        expect(terminal?.outcome?.interrupts).toHaveLength(1);
        if (scenario === 'batch') {
          // One model answer declared both calls.
          const calls = await model(request);
          expect(calls).toHaveLength(1);
          const declarations = calls[0].response.fixture!.response.toolCalls!;
          expect(
            declarations.map((call) => [call.id, call.name])
          ).toEqual([
            ['c0_lookup_expense_policy', 'lookup_expense_policy'],
            ['c0_submit_expense', 'submit_expense'],
          ]);
          const pausedRows = initial.events
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
              call.name,
              JSON.parse(call.arguments),
            ])
          );
          expect(
            pausedRows?.filter((message) => message.role === 'tool')
          ).toHaveLength(0);
        }
        // Paused: the real submit_expense has not run.
        expect(submitted(initial)).toHaveLength(0);
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
        const records = await runs(request),
          calls = await model(request);
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
        const final = records[1].events.find(
          (event) => event.type === 'RUN_FINISHED'
        );
        expect(final?.runId).toBe(records[1].body.runId);
        expect(final?.threadId).toBe(records[1].body.threadId);
        expect(final?.subagentRunId).toBeUndefined();
        if (scenario === 'batch') {
          const finalRows = records[1].events
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
              calls
                .at(-1)!
                .body.messages.filter(
                  (message) =>
                    message.role === 'tool' && message.tool_call_id === callId
                )
                .map((message) => message.content)
            ).toEqual([results?.[0].content]);
          }
          expect(
            records[1].body.messages.filter(
              (message: WireMessage) => message.role === 'tool'
            )
          ).toHaveLength(0);
        }
        // The model answered lookup, submit (or both at once), then the
        // continuation. Its fixtures key on the last tool result it received:
        // the decision's text when that is the submit result, a neutral text
        // when the batch's lookup result comes last.
        const lastTool = calls.at(-1)!.body.messages.at(-1)!;
        expect(answers(calls)).toEqual([
          ...(scenario === 'batch'
            ? ['lookup_expense_policy+submit_expense']
            : ['lookup_expense_policy', 'submit_expense']),
          lastTool.tool_call_id !== 'c0_submit_expense'
            ? 'The Blue Finch Bistro expense decision is complete.'
            : decision === 'Approve'
            ? 'The fictional $220.00 Blue Finch Bistro expense was submitted for reimbursement.'
            : 'The fictional Blue Finch Bistro expense was not submitted.',
        ]);
        expect(
          calls
            .at(-1)!
            .body.messages.filter(
              (message) =>
                message.role === 'tool' &&
                message.tool_call_id === 'c0_submit_expense'
            )
            .map((message) => message.content)
        ).toEqual([decision === 'Approve' ? approved : rejected]);
        // The real submit_expense ran only when approved.
        expect(submitted(records[1])).toHaveLength(decision === 'Approve' ? 1 : 0);
      });
    }

const corruptions: Record<string, unknown[]> = {
  'missing-terminal': [{ type: 'RUN_FINISHED', op: 'drop' }],
  'wrong-terminal': [
    { type: 'RUN_FINISHED', op: 'patch', set: { runId: 'negative-wrong-run' } },
  ],
  // The pause's terminal without its interrupt outcome.
  'draft-only': [{ type: 'RUN_FINISHED', op: 'omit', keys: ['outcome'] }],
  // The pause's terminal downgraded to a child-only observation.
  'child-pause': [
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
for (const scenario of ['missing-terminal', 'wrong-terminal'])
  test(`negative-only ${scenario} leaves actual result unconfirmed`, async ({
    page,
    request,
  }) => {
    await start(page, request);
    await send(page);
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toBeEnabled();
    // Injected data: the proxy corrupts the resumed run's real terminal on its way to the browser.
    expect(
      (
        await request.post('/__stream/edit', {
          data: { ops: corruptions[scenario] },
        })
      ).ok()
    ).toBe(true);
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Expense unconfirmed. Start a new conversation.'
    );
    await expect(
      page.getByRole('region', { name: 'Observed backend result' })
    ).toHaveCount(0);
    const evidence = await runs(request),
      resumed = evidence[1];
    expect(evidence).toHaveLength(2);
    expect(
      resumed.events.some(
        (event) =>
          event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId
      )
    ).toBe(true);
    expect(
      resumed.sent.some(
        (event) =>
          event.type === 'RUN_FINISHED' && event.runId === resumed.body.runId
      )
    ).toBe(false);
    // The real expense was still recorded upstream.
    expect(
      submitted(resumed).map((event) => (event as { content?: string }).content)
    ).toEqual([approved]);
  });

for (const scenario of ['draft-only', 'child-pause'])
  test(`negative-only ${scenario} corruption cannot authorize an approval (child is orphan protocol rejection)`, async ({
    page,
    request,
  }) => {
    await start(page, request);
    // Injected data: the proxy corrupts the pause's real terminal on its way to the browser.
    expect(
      (
        await request.post('/__stream/edit', {
          data: { ops: corruptions[scenario] },
        })
      ).ok()
    ).toBe(true);
    await send(page);
    await expect(page.getByRole('status')).toHaveText(
      'Expense unconfirmed. Start a new conversation.'
    );
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    const evidence = await runs(request);
    expect(evidence).toHaveLength(1);
    expect(submitted(evidence[0])).toHaveLength(0);
    expect(await model(request)).toHaveLength(2);
    expect(evidence[0].sent).not.toEqual(evidence[0].events);
  });

for (const action of ['Stop', 'New conversation', 'unmount'])
  test(`held actual model ${action} closes the run`, async ({
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
    await expect.poll(async () => (await runs(request))[0]?.closed).toBe(true);
    const evidence = await runs(request);
    expect(evidence).toHaveLength(1);
    expect(await model(request)).toHaveLength(1);
    expect(submitted(evidence[0])).toHaveLength(0);
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
    page.getByRole('button', { name: 'Decline', exact: true })
  ).toBeEnabled();
  const after = await runs(request);
  expect(after).toHaveLength(2);
  expect(after[1].body.threadId).not.toBe(before[0].body.threadId);
  expect(await model(request)).toHaveLength(4);
  expect(after.flatMap(submitted)).toHaveLength(0);
});
