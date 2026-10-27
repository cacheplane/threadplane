import assert from 'node:assert/strict';
import { expect } from '@playwright/test';

/** This oracle checks rendered views and owner evidence as well as HTTP verdicts. */
export async function verifyBrowser(browser, server) {
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const errors = [],
    consoleProblems = [],
    external = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      consoleProblems.push(message.text());
  });
  page.on('request', (request) => {
    if (new URL(request.url()).origin !== server.url)
      external.push(request.url());
  });
  await page.goto(server.url);
  const state = () => page.locator('#state').innerText().then(JSON.parse);
  const view = (name) =>
    page.locator(`[data-view="${name}"]`).innerText().then(JSON.parse);
  const conversation = (name) =>
    page.getByRole('region', { name: `${name} conversation`, exact: true });
  const text = async (name, rows) => {
    await expect(conversation(name).locator('li p')).toHaveText(rows);
    await expect(
      conversation(name).locator('[role="log"], [aria-live], [tabindex]')
    ).toHaveCount(0);
  };
  const ready = async () => {
    await expect.poll(async () => (await state()).busy).toBe(false);
    assert.equal((await state()).failure, '');
  };
  const click = async (name) => {
    await expect(page.getByRole('button', { name, exact: true })).toBeEnabled();
    await page.getByRole('button', { name, exact: true }).click();
    await ready();
  };
  await ready();
  const initial = await state(),
    reviewId = initial.reviewId;
  const requests = () =>
    server.stats().requests.filter((request) => request.reviewId === reviewId);
  const shared = async () => {
    const current = await state();
    assert.equal(current.sameReference, true);
    assert.equal(current.reactCurrent, true);
    assert.equal(current.angularCurrent, true);
    assert.equal(current.stable, true);
    assert.deepEqual(await view('react-a'), current.a);
    assert.deepEqual(await view('angular-a'), current.a);
    return current;
  };
  await shared();
  assert.equal(requests().length, 0);
  assert.deepEqual(initial.a.transcript, []);
  assert.deepEqual(initial.b.transcript, []);
  await text('React A', []);
  await text('Angular A', []);
  await text('React B', []);
  const observation = (framework) =>
    page.getByRole('region', {
      name: `${framework} A worker weather`,
      exact: true,
    });
  const toolText = async (framework, args, result) => {
    const region = observation(framework);
    await expect(region).toContainText('weather');
    await expect(region.locator('pre')).toHaveCount(
      result === undefined ? 1 : 2
    );
    assert.equal(await region.locator('pre').nth(0).textContent(), args);
    if (result !== undefined)
      assert.equal(await region.locator('pre').nth(1).textContent(), result);
    await expect(
      region.locator('button, [aria-live], [role="status"]')
    ).toHaveCount(0);
  };
  await expect(observation('React')).toHaveCount(0);
  await expect(observation('Angular')).toHaveCount(0);
  await click('First');
  const partial = await shared();
  const notice = {
    type: 'CUSTOM',
    name: 'on_interrupt',
    value: 'Approve the weather lookup',
    metadata: { source: 'review-notice' },
  };
  assert.deepEqual(partial.a.run.legacyInterrupt, notice);
  assert.equal(partial.a.run.terminal, undefined);
  assert.equal(partial.a.status, 'running');
  assert.equal(requests()[0].closed, false);
  const tool = partial.a.transcript.find(
    (message) => message.role === 'assistant'
  );
  assert.equal(tool.toolCalls[0].function.arguments, '{"city":');
  assert.deepEqual(partial.a.state, {
    model: 'review-small',
    reasoning_effort: 'high',
    gen_ui_mode: 'inline',
    count: 1,
  });
  assert.equal(partial.a.subagents[0].started.name, 'Worker');
  assert.equal(partial.a.subagents[0].terminal, undefined);
  assert.equal(partial.a.toolCalls, undefined);
  await text('React A', ['First']);
  await text('Angular A', ['First']);
  await toolText('React', '{"city":');
  await toolText('Angular', '{"city":');
  const oldReactArgs = await observation('React')
    .locator('pre')
    .first()
    .elementHandle();
  const oldAngularArgs = await observation('Angular')
    .locator('pre')
    .first()
    .elementHandle();
  const oldReactRow = await conversation('React A')
    .locator('li')
    .first()
    .elementHandle();
  const oldAngularRow = await conversation('Angular A')
    .locator('li')
    .first()
    .elementHandle();
  await expect(page.locator('[data-view="react-a"]')).toContainText('weather');
  await expect(page.locator('[data-view="angular-a"]')).toContainText(
    'weather'
  );
  await click('Remove React');
  await expect(page.locator('[data-view="react-a"]')).toHaveCount(0);
  assert.equal(await oldReactRow.evaluate((node) => node.isConnected), false);
  assert.equal(requests()[0].closed, false);
  await click('Advance first');
  await toolText('Angular', '{"city":"Paris"}', '{"temperature":20}');
  assert.equal(
    await oldAngularArgs.evaluate(
      (node) =>
        node ===
        document.querySelector(
          'section[aria-label="Angular A worker weather"] pre'
        )
    ),
    true
  );
  const paused = await state();
  assert.deepEqual(paused.a.run.legacyInterrupt, notice);
  assert.equal(paused.records[0].outcome, 'paused');
  assert.equal(paused.a.subagents[0].terminal.outcome.type, 'suspended');
  assert.equal(paused.a.run.terminal.outcome.type, 'interrupt');
  assert.equal(paused.a.decision.kind, 'native');
  assert.equal(paused.a.decision.attempt, undefined);
  assert.equal(paused.a.decision.sourceRunId, paused.a.run.id);
  assert.equal(
    paused.a.transcript.find((message) => message.role === 'assistant')
      .toolCalls[0].function.arguments,
    '{"city":"Paris"}'
  );
  assert.deepEqual(paused.a.state, { count: 2 });
  assert.deepEqual(await view('angular-a'), paused.a);
  await expect(page.locator('[data-view="angular-a"]')).toContainText('Hello');
  assert.equal(requests()[0].closed, true);
  await text('Angular A', ['First']);
  assert.equal(
    await oldAngularRow.evaluate(
      (node) =>
        node ===
        document.querySelector(
          'section[aria-label="Angular A conversation"] li'
        )
    ),
    true
  );
  await click('Mount React');
  await toolText('React', '{"city":"Paris"}', '{"temperature":20}');
  assert.equal(await oldReactArgs.evaluate((node) => node.isConnected), false);
  const remounted = await shared();
  assert.deepEqual(remounted.a.run.legacyInterrupt, notice);
  assert.deepEqual(remounted.a.run.terminal, paused.a.run.terminal);
  assert.equal(requests().length, 1);
  await text('React A', ['First']);
  assert.equal(
    await oldReactRow.evaluate(
      (node) =>
        node ===
        document.querySelector('section[aria-label="React A conversation"] li')
    ),
    false
  );
  const mountedReactRow = await conversation('React A')
    .locator('li')
    .first()
    .elementHandle();
  await click('Resume');
  const second = await shared();
  assert.equal(second.a.transcript.at(-1).content, 'Next answer');
  assert.equal(second.a.decision.id, paused.a.decision.id);
  assert.equal(second.a.decision.attempt.runId, second.a.run.id);
  assert.deepEqual(second.a.decision.attempt.responses, [
    {
      interruptId: 'approval',
      status: 'resolved',
      payload: { approved: true },
    },
  ]);
  assert.deepEqual(requests()[1].body.messages, paused.a.transcript);
  assert.deepEqual(requests()[1].body.state, { count: 2 });
  assert.deepEqual(requests()[1].body.resume, [
    {
      interruptId: 'approval',
      status: 'resolved',
      payload: { approved: true },
    },
  ]);
  assert.equal(requests().length, 2);
  await text('React A', ['First', 'Next answer']);
  await text('Angular A', ['First', 'Next answer']);
  assert.equal(
    await oldAngularRow.evaluate(
      (node) =>
        node ===
        document.querySelector(
          'section[aria-label="Angular A conversation"] li'
        )
    ),
    true
  );
  await click('Remove Angular');
  await expect(page.locator('[data-view="angular-a"]')).toHaveCount(0);
  assert.equal(await oldAngularRow.evaluate((node) => node.isConnected), false);
  assert.equal(requests()[1].closed, false);
  await click('Complete resume');
  const completed = await state();
  assert.equal(completed.records[1].outcome, 'success');
  assert.equal(completed.a.decision, undefined);
  assert.deepEqual(await view('react-a'), completed.a);
  await expect(page.locator('[data-view="react-a"]')).toContainText(
    'Next answer'
  );
  assert.equal(requests()[1].closed, true);
  assert.equal(
    await mountedReactRow.evaluate(
      (node) =>
        node ===
        document.querySelector('section[aria-label="React A conversation"] li')
    ),
    true
  );
  await click('Mount Angular');
  await toolText('Angular', '{"city":"Paris"}', '{"temperature":20}');
  assert.equal(
    await oldAngularArgs.evaluate((node) => node.isConnected),
    false
  );
  await shared();
  assert.equal(requests().length, 2);
  await text('Angular A', ['First', 'Next answer']);
  assert.equal(
    await oldAngularRow.evaluate(
      (node) =>
        node ===
        document.querySelector(
          'section[aria-label="Angular A conversation"] li'
        )
    ),
    false
  );
  const beforeOther = (await state()).a;
  await click('Start other');
  const other = await state();
  assert.deepEqual(other.a, beforeOther);
  assert.deepEqual(other.b.state, { count: 99 });
  assert.equal(other.b.transcript.at(-1).content, 'Other answer');
  assert.deepEqual(await view('react-b'), other.b);
  await text('React B', ['Other', 'Other answer']);
  await click('Cancelable');
  const active = await shared();
  assert.deepEqual(active.a.state, { count: 3 });
  assert.equal(active.a.transcript.at(-1).content, 'Cancelable answer');
  assert.deepEqual(active.b, other.b);
  await click('Stop A');
  const stopped = await shared();
  assert.equal(stopped.records[3].outcome, 'aborted');
  assert.equal(stopped.b.status, 'running');
  assert.deepEqual(stopped.b, other.b);
  assert.equal(requests()[3].closed, true);
  assert.equal(requests()[2].closed, false);
  await click('Dispose');
  const disposed = await shared();
  assert.equal(disposed.disposed, true);
  assert.equal(disposed.records[2].outcome, 'aborted');
  await click('Try disposed');
  const final = await shared();
  assert.equal(final.records[4].outcome, 'aborted');
  assert.deepEqual(final.a, disposed.a);
  assert.deepEqual(final.b, disposed.b);
  assert.deepEqual(await view('react-b'), final.b);
  assert.equal(final.otherCurrent, true);
  assert.equal(final.nextAction, 'Complete');
  await text('React A', [
    'First',
    'Next answer',
    'Cancelable',
    'Cancelable answer',
  ]);
  await text('Angular A', [
    'First',
    'Next answer',
    'Cancelable',
    'Cancelable answer',
  ]);
  await expect
    .poll(
      () =>
        requests().length === 4 &&
        requests().every((request) => request.closed && request.verified)
    )
    .toBe(true);
  assert.deepEqual(server.stats().errors, []);
  assert.deepEqual(errors, []);
  assert.deepEqual(consoleProblems, []);
  assert.deepEqual(external, []);
  // Evidence is captured here, before runReview closes either browser or server.
  return {
    reviewId,
    requests: requests(),
    outcomes: final.records,
    sameReference: final.sameReference,
    stable: final.stable,
    closedBeforeCleanup: true,
    errors,
    consoleProblems,
    external,
  };
}
