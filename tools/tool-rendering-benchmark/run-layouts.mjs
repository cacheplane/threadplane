// Layout comparison for confirmed reference results (`?layout=sources|summary|compact|cards`).
// Uses real composer input against the scripted local agent, then only reads the
// rendered turn. It measures visible repetition and checks that every layout keeps
// the sources, the collapsed activity, the literal details and the failed-call state.
// It does not rank the layouts: comprehension is a human judgement.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { getScenario } from './scenarios.mjs';

const output = resolve(
  process.argv[2] ?? '/private/tmp/threadplane-layout-evidence'
);
mkdirSync(output, { recursive: true });
const backend = 'http://127.0.0.1:4809';
const hosts = [
  { id: 'threadplane-angular', url: 'http://127.0.0.1:4812/' },
  { id: 'threadplane-react', url: 'http://127.0.0.1:4811/' },
];
const layouts = ['sources', 'summary', 'compact', 'cards'];
const views = [
  { id: 'desktop', viewport: { width: 1440, height: 1000 } },
  { id: 'mobile', viewport: { width: 480, height: 900 } },
];
const themes = ['light', 'dark'];
// The fixture's two facts, each recognised by the word only its statements use.
const facts = [
  { id: 'angular-signals', word: /\breactive\b/i },
  { id: 'array-to-sorted', word: /\bsorted\b.*\bcop/i },
];
const urls = [
  'https://angular.dev/guide/signals',
  'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/toSorted',
];
const assistant =
  'chat-message[data-role=assistant], .tp-chat-message--assistant';
const groupToggle =
  '.tp-tool-activity-group__details > summary, .ctc__group-header:not([hidden])';

const receipts = async (id) =>
  (await (await fetch(`${backend}/receipts`)).json()).filter(
    (run) => run.participant === id
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
async function run(page, host, scenario, layout) {
  const before = new Set((await receipts(host.id)).map((row) => row.id));
  await fetch(`${backend}/reset/${host.id}`, { method: 'POST' });
  await page.goto(`${host.url}?scenario=${scenario}&layout=${layout}`);
  await page.getByRole('textbox').fill(getScenario(scenario).prompt);
  await page.getByRole('textbox').press('Enter');
  await until(
    () => receipts(host.id),
    (rows) =>
      rows.some(
        (row) =>
          !before.has(row.id) &&
          row.scenario === scenario &&
          row.status !== 'running'
      ),
    `${host.id} ${scenario} ${layout}`
  );
  await page.locator(assistant).last().waitFor({ state: 'visible' });
  // Let the final frame settle; motion is reduced, so this is layout only.
  await page.waitForTimeout(250);
}
/** Reads the last assistant turn as a sighted user sees it, without changing it. */
const measure = (page) =>
  page.evaluate(
    ({ assistant, groupToggle, urls }) => {
      const turn = [...document.querySelectorAll(assistant)].at(-1);
      const shown = (node) => {
        if (!node.getClientRects().length) return false;
        for (let at = node; at && at !== turn; at = at.parentElement) {
          const style = getComputedStyle(at);
          if (style.visibility === 'hidden' || style.display === 'none')
            return false;
          // Text kept only for assistive technology is not visible repetition.
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
      const walker = document.createTreeWalker(turn, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent.replace(/\s+/g, ' ').trim();
        if (text && shown(node.parentElement)) blocks.push(text);
      }
      const links = [...turn.querySelectorAll('a[href]')].filter(shown);
      const toggle = turn.querySelector(groupToggle);
      const box = turn.getBoundingClientRect();
      return {
        blocks,
        words: blocks.join(' ').split(/\s+/).filter(Boolean).length,
        height: Math.round(box.height),
        links: urls.map(
          (url) => links.filter((link) => link.href === url).length
        ),
        collapsed: toggle
          ? toggle.tagName === 'SUMMARY'
            ? !toggle.parentElement.open
            : toggle.getAttribute('aria-expanded') !== 'true'
          : null,
        toggle: toggle?.textContent.replace(/\s+/g, ' ').trim() ?? null,
        overflow:
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      };
    },
    { assistant, groupToggle, urls }
  );
// The Sources panel keeps its links behind one disclosure; open it when the
// collapsed turn shows none, and report that the links needed that step.
async function withSources(page, seen, expected = seen.links.length) {
  if (seen.links.slice(0, expected).every((count) => count >= 1))
    return { seen, sourcesBehindDisclosure: false };
  const toggle = page
    .locator(assistant)
    .last()
    .locator(':is(button, summary)', { hasText: 'Sources' })
    .first();
  await toggle.focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(150);
  return { seen: await measure(page), sourcesBehindDisclosure: true };
}
const sentences = (blocks) =>
  blocks.flatMap((block) => block.split(/(?<=[.!?])\s+/)).filter(Boolean);

const rows = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const host of hosts)
    for (const layout of layouts) {
      const row = { host: host.id, layout, views: [], errors: [] };
      for (const view of views)
        for (const theme of themes) {
          const context = await browser.newContext({
            viewport: view.viewport,
            colorScheme: theme,
            reducedMotion: 'reduce',
          });
          const page = await context.newPage();
          page.on('pageerror', (error) => row.errors.push(error.message));
          await run(page, host, 'references', layout);
          const seen = await measure(page);
          const stated = sentences(seen.blocks);
          const entry = {
            view: view.id,
            theme,
            words: seen.words,
            height: seen.height,
            // How many visible sentences state each fact; 1 means no repetition.
            statements: Object.fromEntries(
              facts.map((fact) => [
                fact.id,
                stated.filter((sentence) => fact.word.test(sentence)).length,
              ])
            ),
            links: seen.links,
            toggle: seen.toggle,
          };
          assert.equal(seen.collapsed, true, 'Activity stays collapsed');
          assert.equal(seen.overflow, false, 'No horizontal overflow');
          assert.ok(
            Object.values(entry.statements).every((count) => count >= 1),
            'Every fact is stated at least once'
          );
          const file = `${host.id}-${layout}-${view.id}-${theme}.png`;
          await page.screenshot({ path: join(output, file) });
          entry.capture = file;
          const opened = await withSources(page, seen);
          entry.sourcesBehindDisclosure = opened.sourcesBehindDisclosure;
          entry.linksReachable = opened.seen.links;
          assert.ok(
            opened.seen.links.every((count) => count >= 1),
            'Every source is a visible link, at most one disclosure away'
          );
          if (opened.sourcesBehindDisclosure) {
            entry.expandedHeight = opened.seen.height;
            entry.expandedCapture = file.replace('.png', '-sources-open.png');
            await page.screenshot({
              path: join(output, entry.expandedCapture),
            });
          }
          if (view.id === 'desktop' && theme === 'light') {
            // Manual expansion still reaches every call's literal result.
            const toggle = page.locator(groupToggle).first();
            await toggle.focus();
            await page.keyboard.press('Enter');
            // Each call keeps its own closed Details inside the opened group.
            const inner = page
              .locator(assistant)
              .last()
              .locator('summary, button[aria-expanded="false"]');
            for (let index = 0; index < (await inner.count()); index++) {
              const control = inner.nth(index);
              const closed = await control.evaluate((el) =>
                el.tagName === 'SUMMARY'
                  ? !el.parentElement.open
                  : el.getAttribute('aria-expanded') === 'false'
              );
              if (closed && (await control.isVisible())) await control.click();
            }
            const literal = await page.evaluate(
              (assistant) =>
                [...document.querySelectorAll(assistant)].at(-1).innerText,
              assistant
            );
            entry.detailsReachable = urls.every((url) => literal.includes(url));
            assert.ok(
              entry.detailsReachable,
              'Literal results stay in Details'
            );
          }
          row.views.push(entry);
          await context.close();
        }
      // A failed read must stay visibly failed, with the retained success, in every layout.
      const context = await browser.newContext({
        viewport: views[0].viewport,
        colorScheme: 'light',
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      page.on('pageerror', (error) => row.errors.push(error.message));
      await run(page, host, 'partial-failure', layout);
      const failed = await measure(page);
      await page.screenshot({
        path: join(output, `${host.id}-${layout}-partial-failure.png`),
      });
      const retained = (await withSources(page, failed, 1)).seen.links[0];
      row.partialFailure = {
        toggle: failed.toggle,
        alert: await page
          .locator(
            '.tp-status-panel[role=alert], [chatStatusPanel][role=alert]'
          )
          .first()
          .innerText(),
        retainedSource: retained,
      };
      assert.match(failed.toggle ?? '', /1 failed/, 'Failure is counted');
      assert.match(row.partialFailure.alert, /Retry array-to-sorted read/);
      assert.ok(retained >= 1, 'Successful reference is retained');
      await context.close();
      assert.deepEqual(row.errors, [], 'No page errors');
      rows.push(row);
    }
} finally {
  await browser.close();
}
writeFileSync(
  join(output, 'layout-evidence.json'),
  JSON.stringify({ facts: facts.map((fact) => fact.id), rows }, null, 2) + '\n'
);
console.log(
  JSON.stringify(
    rows.map((row) => ({
      host: row.host,
      layout: row.layout,
      desktop: row.views[0],
      mobile: row.views[2],
    })),
    null,
    2
  )
);
