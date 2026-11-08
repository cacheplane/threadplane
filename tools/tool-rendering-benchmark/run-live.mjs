// Real browser inputs + native SSE transports. Never inject completed transcript DOM.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { getScenario } from './scenarios.mjs';

const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
const participants = [
  { id: 'threadplane-angular', url: 'http://127.0.0.1:4812/' },
  { id: 'threadplane-react', url: 'http://127.0.0.1:4811/' },
  {
    id: 'assistant-ui',
    url: 'http://127.0.0.1:4810/?participant=assistant-ui',
  },
  { id: 'copilotkit', url: 'http://127.0.0.1:4810/?participant=copilotkit' },
  { id: 'shadcn', url: 'http://127.0.0.1:4810/?participant=shadcn' },
];
const json = (name, value) =>
  writeFileSync(
    join(output, name + '.json'),
    JSON.stringify(value, null, 2) + '\n'
  );
const receipts = () =>
  fetch('http://127.0.0.1:4809/receipts').then((response) => response.json());
const observe = page => page.evaluate(() => ({ viewport: [innerWidth, innerHeight, devicePixelRatio], text: document.querySelector('main')?.innerText, samples: window.__toolBenchmark?.samples }));
async function until(read, condition, label) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (condition(value)) return value;
    await new Promise((done) => setTimeout(done, 50));
  }
  throw new Error('Timed out: ' + label);
}
const ledger = (receipt) =>
  receipt.tools.map(
    ({
      canonicalId,
      name,
      argsHash,
      resultHash,
      errorHash,
      executionCount,
    }) => ({
      canonicalId,
      name,
      argsHash,
      resultHash,
      errorHash,
      executionCount,
    })
  );
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const evidence = [],
  equality = new Map();
try {
  for (const participant of participants) {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      deviceScaleFactor: 1,
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    await context.addInitScript(() => {
      window.__toolBenchmark = { samples: [], start: performance.now() };
      addEventListener('DOMContentLoaded', () => {
        let previous = '';
        const observer = new MutationObserver(() => {
          const text = document.querySelector('main')?.innerText ?? '';
          if (text !== previous) {
            previous = text;
            window.__toolBenchmark.samples.push({
              at: performance.now(),
              text: text.slice(-20_000),
            });
          }
        });
        observer.observe(document.body, {
          childList: true,
          characterData: true,
          subtree: true,
        });
      });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    for (const scenario of [
      'references',
      'repeated',
      'falsy',
      'tool-error',
      'slow',
    ]) {
      let firstTurnObservation;
      await fetch('http://127.0.0.1:4809/reset/' + participant.id, {
        method: 'POST',
      });
      const existing = new Set((await receipts()).map((receipt) => receipt.id));
      const url = new URL(participant.url);
      url.searchParams.set('scenario', scenario);
      await page.goto(url.href);
      await page
        .locator('textarea:visible')
        .last()
        .fill(getScenario(scenario).prompt);
      await page.getByRole('button', { name: /^Send( message)?$/ }).click();
      const current = async () =>
        (await receipts()).find(
          (receipt) =>
            receipt.participant === participant.id && !existing.has(receipt.id)
        );
      if (scenario === 'slow') {
        await until(
          current,
          (run) => run?.tools[0]?.argsCompletedAt,
          participant.id + ' argument boundary'
        );
        await page.screenshot({
          path: join(output, `${participant.id}-running.png`),
        });
        await page
          .getByRole('button', { name: /^Stop( generating)?$/ })
          .click();
      }
      const receipt = await until(
        current,
        (run) => run && ['complete', 'error', 'aborted'].includes(run.status),
        participant.id + '/' + scenario
      );
      assert.equal(receipt.promptHash, receipt.expectedPromptHash);
      assert.ok(receipt.tools.every((tool) => tool.executionCount <= 1));
      if (scenario === 'slow') {
        assert.equal(receipt.status, 'aborted');
        const before = JSON.stringify(ledger(receipt));
        await page.waitForTimeout(2200);
        assert.equal(
          JSON.stringify(ledger(await current())),
          before,
          'Stop fences late tool work'
        );
      } else {
        assert.equal(
          receipt.status,
          scenario === 'tool-error' ? 'error' : 'complete'
        );
        assert.equal(receipt.tools.length, getScenario(scenario).calls.length);
        if (equality.has(scenario))
          assert.deepEqual(ledger(receipt), equality.get(scenario));
        else equality.set(scenario, ledger(receipt));
      }
      await until(
        async () => {
          const stop = page.getByRole('button', {
            name: /^Stop( generating)?$/,
          });
          return (
            (await stop.count()) === 0 || !(await stop.first().isEnabled())
          );
        },
        Boolean,
        participant.id + ' rendered delivery settlement'
      );
      if (scenario !== 'slow' && scenario !== 'tool-error') {
        await until(
          () => page.locator('main').innerText(),
          (text) => text.includes(getScenario(scenario).conclusion),
          participant.id + ' rendered final answer'
        );
      } else if (scenario === 'tool-error') {
        await until(
          () => page.locator('main').innerText(),
          (text) => /Reference unavailable|failed|Failed|Stopped/.test(text),
          participant.id + ' visible error or native stopped outcome'
        );
      }
      await page.evaluate(() => document.fonts.ready);
      if (scenario === 'references') {
        for (const [name, colorScheme, width, height] of [
          ['light', 'light', 1440, 1000],
          ['dark', 'dark', 1440, 1000],
          ['compact', 'light', 1024, 900],
        ]) {
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await page.setViewportSize({ width, height });
          await page.screenshot({
            path: join(output, `${participant.id}-references-${name}.png`),
          });
        }
        await page.emulateMedia({
          colorScheme: 'light',
          reducedMotion: 'reduce',
        });
        await page.setViewportSize({ width: 1440, height: 1000 });
        // Exercise the actual native disclosure controls; do not set `open` via JS.
        // Open a representative technical inspection through its real controls.
        // Stop once literal evidence is visible; expanding every payload would
        // change the reading position and make the screenshot phase ambiguous.
        for (let expanded = 0; expanded < 4 && !await page.locator('main pre:visible').count(); expanded++) {
          const closed = page.locator('main details:not([open]) > summary:visible, main button[aria-expanded="false"]:enabled:visible');
          if (!await closed.count()) break;
          const control = await closed.first().elementHandle();
          assert.ok(control);
          await control.click();
          // Wait for this control's render before querying the next closed row.
          // Otherwise a fast second click can close the same group again.
          await until(() => control.evaluate(element => element.tagName === 'SUMMARY' ? element.parentElement.open : element.getAttribute('aria-expanded') === 'true'), Boolean, participant.id + ' disclosure commit');
        }
        await page.screenshot({
          path: join(output, `${participant.id}-references-details.png`),
        });
        // Follow-up uses the same mounted native thread, then receives a distinct invocation ledger.
        firstTurnObservation = await observe(page);
        const followupExisting = new Set(
          (await receipts()).map((run) => run.id)
        );
        await page
          .locator('textarea:visible')
          .last()
          .fill(getScenario(scenario).prompt);
        await page.getByRole('button', { name: /^Send( message)?$/ }).click();
        const followup = await until(
          async () =>
            (
              await receipts()
            ).find(
              (run) =>
                run.participant === participant.id &&
                !followupExisting.has(run.id)
            ),
          (run) => run?.status === 'complete',
          participant.id + ' same-thread follow-up'
        );
        assert.deepEqual(ledger(followup), equality.get('references'));
        assert.equal(followup.threadId, receipt.threadId);
        assert.ok(
          followup.tools.every(
            (tool) =>
              !receipt.tools.some(
                (previous) => previous.nativeId === tool.nativeId
              )
          )
        );
        await until(
          async () =>
            page
              .getByRole('button', { name: /^Stop( generating)?$/ })
              .evaluateAll((buttons) =>
                buttons.every((button) => button.disabled)
              ),
          Boolean,
          'follow-up visible settlement'
        );
        json(`${participant.id}-followup`, {
          receipt: followup,
          sameThread: true,
          distinctNativeToolIds: true,
          text: await page.locator('main').innerText(),
        });
      }
      json(`${participant.id}-${scenario}`, {
        receipt,
        observation: firstTurnObservation ?? await observe(page),
        consoleErrors: [...errors],
        approvalUi:
          'N/A: this controlled integration does not wire native approval/resume UI',
      });
      evidence.push({
        participant: participant.id,
        scenario,
        status: receipt.status,
        nativeRunId: receipt.nativeRunId,
        runId: receipt.id,
      });
      await Promise.all([
        page.waitForEvent('load'),
        page
          .getByRole('button', { name: 'New conversation', exact: true })
          .click(),
      ]);
      await until(
        async () => page.locator('textarea').count(),
        (count) => count > 0,
        'new conversation composer'
      );
      console.log(JSON.stringify(evidence.at(-1)));
    }
    assert.deepEqual(
      errors,
      [],
      'No unhandled renderer errors: ' + participant.id
    );
    await context.close();
  }
  json('index', {
    agent: 'scripted local agent; not a model benchmark',
    participants,
    evidence,
    matchedCanonicalLedgers: [...equality.keys()],
  });
} finally {
  await browser.close();
}
