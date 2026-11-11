// Deep-workflow fixture (`?scenario=deep-workflow`): plan → delegation → parent
// read → gated save → approve or deny → reload and restore the thread.
// Uses real composer and approval controls against the scripted local agent.
// It asserts the effects from the server's ledger (what ran, how often, what was
// written) and that a reload runs nothing. What each host shows for the plan,
// the delegated reads and the restored thread is recorded, not ranked.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { getScenario } from './scenarios.mjs';

const output = resolve(
  process.argv[2] ?? '/private/tmp/threadplane-deep-evidence'
);
mkdirSync(output, { recursive: true });
const backend = 'http://127.0.0.1:4809';
const hosts = [
  { id: 'threadplane-angular', url: 'http://127.0.0.1:4812/' },
  { id: 'threadplane-react', url: 'http://127.0.0.1:4811/' },
];
const scenario = getScenario('deep-workflow');
const urls = [
  'https://angular.dev/guide/signals',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted',
];
// Things a reader could look for in the turn. Text comes from the fixture and
// from this application's own labels and outcome decoders.
const facts = (decision) => ({
  prompt: scenario.prompt,
  planLabel: 'Planning the work',
  planSteps: 'Check the sorted-copy claim',
  delegationLabel: 'Delegating the reading',
  delegationOutcome: 'The reader checked 2 references.',
  subagentName: 'reference-reader',
  subagentSummary: 'Both references were read.',
  parentReadLabel: 'Reading reference sources',
  decisionOutcome:
    decision === 'approve'
      ? /Note note-\d+ in the local benchmark store\./
      : 'Save declined. No note was saved.',
  answer:
    decision === 'approve'
      ? scenario.conclusion
      : 'Saving the note was cancelled.',
});

const get = async (path) => (await fetch(backend + path)).json();
const runs = async (id) =>
  (await get('/receipts')).filter(
    (run) => run.participant === id && run.scenario === scenario.id
  );
async function until(read, condition, label) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const value = await read();
    if (condition(value)) return value;
    await new Promise((done) => setTimeout(done, 80));
  }
  throw new Error('Timed out: ' + label);
}
const shape = (tools) =>
  tools.map((tool) => [
    tool.canonicalId,
    tool.status,
    tool.executionCount,
    tool.parent ?? null,
  ]);
/** Text a sighted reader sees in the conversation, without changing it. */
const visibleText = (page) =>
  page.evaluate(() => {
    const root = document.querySelector('main');
    const shown = (node) => {
      if (!node.getClientRects().length) return false;
      for (let at = node; at && at !== root; at = at.parentElement) {
        const style = getComputedStyle(at);
        if (style.visibility === 'hidden' || style.display === 'none')
          return false;
        const box = at.getBoundingClientRect();
        if (box.width <= 1 || box.height <= 1) return false;
        if (at.tagName === 'DETAILS' && !at.open && node !== at) {
          const summary = at.querySelector(':scope > summary');
          if (!summary?.contains(node)) return false;
        }
      }
      return true;
    };
    const blocks = [];
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      if (text && shown(node.parentElement)) blocks.push(text);
    }
    return {
      text: blocks.join('\n'),
      links: [...root.querySelectorAll('a[href]')]
        .filter(shown)
        .map((link) => link.href),
      overflow:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    };
  });
/** Opens every closed disclosure in the conversation with a real click. */
async function expandAll(page) {
  for (let pass = 0; pass < 6; pass++) {
    const closed = page.locator(
      'main details:not([open]) > summary, main button[aria-expanded="false"]'
    );
    let opened = 0;
    for (let index = 0; index < (await closed.count()); index++) {
      const control = closed.nth(index);
      if (!(await control.isVisible())) continue;
      await control.click();
      opened++;
      break;
    }
    if (!opened) return;
    await page.waitForTimeout(80);
    pass = 0;
    if ((await closed.count()) === 0) return;
  }
}
const has = (seen, fact) =>
  fact instanceof RegExp ? fact.test(seen.text) : seen.text.includes(fact);
/** Each fact, as seen with everything closed and again with everything opened. */
async function observe(page, decision, capture, { open = true } = {}) {
  await page.waitForTimeout(400);
  const collapsed = await visibleText(page);
  await page.screenshot({ path: join(output, capture + '.png') });
  // While a decision is pending the turn is only read, so nothing opened here
  // carries into the next observation.
  if (open) await expandAll(page);
  const expanded = open ? await visibleText(page) : collapsed;
  if (open)
    await page.screenshot({
      path: join(output, capture + '-expanded.png'),
      fullPage: true,
    });
  const read = Object.fromEntries(
    Object.entries(facts(decision)).map(([name, fact]) => [
      name,
      has(collapsed, fact)
        ? 'visible'
        : has(expanded, fact)
        ? 'opened'
        : open
        ? 'absent'
        : 'not visible',
    ])
  );
  return {
    facts: read,
    childReads: expanded.text.split(facts(decision).parentReadLabel).length - 1,
    sourceLinks: urls.map(
      (url) => expanded.links.filter((link) => link === url).length
    ),
    overflow: collapsed.overflow || expanded.overflow,
    captures: open
      ? [capture + '.png', capture + '-expanded.png']
      : [capture + '.png'],
  };
}

const rows = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const host of hosts)
    for (const decision of ['approve', 'deny']) {
      const row = { host: host.id, decision, errors: [] };
      const context = await browser.newContext({
        viewport: { width: 1440, height: 1000 },
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => row.errors.push(error.message));
      const tag = `${host.id}-${decision}`;
      await fetch(`${backend}/reset/${host.id}`, { method: 'POST' });
      const before = new Set((await runs(host.id)).map((run) => run.id));
      const notesBefore = (await get('/notes')).count;
      await page.goto(`${host.url}?scenario=${scenario.id}`);
      await page.getByRole('textbox').fill(scenario.prompt);
      await page.getByRole('textbox').press('Enter');

      // Plan, delegation and the parent read run; the save waits.
      const paused = (
        await until(
          () => runs(host.id),
          (all) =>
            all.some((run) => !before.has(run.id) && run.status === 'paused'),
          tag + ' pause'
        )
      ).find((run) => !before.has(run.id));
      assert.deepEqual(shape(paused.tools), [
        ['plan', 'complete', 1, null],
        ['delegate-reading', 'complete', 1, null],
        ['child-read-angular', 'complete', 1, 'delegate-reading'],
        ['child-read-sorted', 'complete', 1, 'delegate-reading'],
        ['check-sorted', 'complete', 1, null],
        ['save-comparison', 'waiting', 0, null],
      ]);
      assert.equal(paused.promptHash, paused.expectedPromptHash);
      assert.equal((await get('/notes')).count, notesBefore);
      const control = page.getByRole('button', {
        name: decision === 'approve' ? 'Approve save' : 'Deny save',
      });
      await control.waitFor({ state: 'visible' });
      row.waiting = await observe(page, decision, tag + '-waiting', {
        open: false,
      });
      delete row.waiting.facts.decisionOutcome;
      delete row.waiting.facts.answer;

      // The decision is made with the keyboard on the real control.
      await control.focus();
      await page.keyboard.press('Enter');
      const resumed = (
        await until(
          () => runs(host.id),
          (all) =>
            all.some(
              (run) =>
                run.sourceRunId === paused.nativeRunId &&
                run.status !== 'running'
            ),
          tag + ' decision'
        )
      ).find((run) => run.sourceRunId === paused.nativeRunId);
      assert.equal(
        resumed.status,
        decision === 'approve' ? 'complete' : 'denied'
      );
      assert.deepEqual(shape(resumed.tools), [
        decision === 'approve'
          ? ['save-comparison', 'complete', 1, null]
          : ['save-comparison', 'denied', 0, null],
      ]);
      const notesAfter = (await get('/notes')).count;
      assert.equal(notesAfter - notesBefore, decision === 'approve' ? 1 : 0);
      await control.waitFor({ state: 'detached' });
      row.live = await observe(page, decision, tag + '-live');

      // Reload: the thread comes back from the server and nothing runs.
      const runCount = (await get('/receipts')).length;
      const restoresBefore = (await get('/restores')).length;
      await page.reload();
      await page.getByRole('textbox').waitFor({ state: 'visible' });
      row.restoreRequests = (
        await until(
          () => get('/restores'),
          (all) =>
            all
              .slice(restoresBefore)
              .some((entry) => entry.participant === host.id && entry.found),
          tag + ' history request'
        )
      )
        .slice(restoresBefore)
        .filter((entry) => entry.participant === host.id)
        .map(({ kind, found, events }) => ({ kind, found, events }));
      await page
        .getByText(scenario.prompt, { exact: true })
        .first()
        .waitFor({ state: 'visible' });
      row.restored = await observe(page, decision, tag + '-restored');
      assert.equal(
        (await get('/receipts')).length,
        runCount,
        'No run on reload'
      );
      assert.equal(
        (await get('/notes')).count,
        notesAfter,
        'No write on reload'
      );
      assert.equal(
        await page
          .getByRole('button', { name: /Approve save|Deny save/ })
          .count(),
        0,
        'A settled decision is not offered again'
      );
      assert.equal(await page.getByRole('textbox').isEnabled(), true);
      for (const name of ['prompt', 'decisionOutcome', 'answer'])
        for (const phase of ['live', 'restored'])
          assert.notEqual(
            row[phase].facts[name],
            'absent',
            `${tag}: ${name} is readable ${phase}`
          );
      assert.equal(row.live.overflow || row.restored.overflow, false);
      // Where the restored thread reads differently from the live one.
      row.restoreDifferences = Object.keys(row.live.facts)
        .filter((name) => row.live.facts[name] !== row.restored.facts[name])
        .map((name) => ({
          fact: name,
          live: row.live.facts[name],
          restored: row.restored.facts[name],
        }));
      if (row.live.childReads !== row.restored.childReads)
        row.restoreDifferences.push({
          fact: 'readRows',
          live: row.live.childReads,
          restored: row.restored.childReads,
        });

      // The restored thread on a phone-width viewport and in dark.
      await page.reload();
      await page
        .getByText(scenario.prompt, { exact: true })
        .first()
        .waitFor({ state: 'visible' });
      await page.setViewportSize({ width: 480, height: 900 });
      await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.waitForTimeout(300);
      await page.screenshot({
        path: join(output, tag + '-restored-mobile-dark.png'),
      });
      row.mobileOverflow = (await visibleText(page)).overflow;
      assert.equal(
        row.mobileOverflow,
        false,
        'No horizontal overflow at 480px'
      );
      assert.deepEqual(row.errors, [], 'No page errors');
      await context.close();
      rows.push(row);
    }
} finally {
  await browser.close();
}
writeFileSync(
  join(output, 'deep-evidence.json'),
  JSON.stringify({ scenario: scenario.id, rows }, null, 2) + '\n'
);
console.log(
  JSON.stringify(
    rows.map((row) => ({
      host: row.host,
      decision: row.decision,
      waiting: row.waiting.facts,
      live: row.live.facts,
      restored: row.restored.facts,
      readRows: [row.live.childReads, row.restored.childReads],
      sourceLinks: [row.live.sourceLinks, row.restored.sourceLinks],
      restoreRequests: row.restoreRequests,
      restoreDifferences: row.restoreDifferences,
    })),
    null,
    2
  )
);
