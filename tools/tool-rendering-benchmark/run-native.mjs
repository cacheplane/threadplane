// Native SDK host checks. Uses real composer/control input; evaluations only read
// geometry/accessibility state or scroll/focus existing DOM. Never injects a transcript.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { chromium } from '@playwright/test';
import { getScenario } from './scenarios.mjs';

const output = resolve(
  process.argv[2] ?? '/private/tmp/threadplane-native-evidence'
);
mkdirSync(output, { recursive: true });
const backend = 'http://127.0.0.1:4809';
const hosts = [
  { id: 'threadplane-angular', url: 'http://127.0.0.1:4812/' },
  { id: 'threadplane-react', url: 'http://127.0.0.1:4811/' },
];
const rawReceipts = async (id) =>
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
// React renders the group primitive; Angular's <chat> renders its default tool rows.
const groupToggle =
  '.tp-tool-activity-group__details > summary, .ctc__group-header:not([hidden])';
const evidence = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  for (const host of hosts) {
    let previousRuns = new Set();
    const receipt = async () =>
      (await rawReceipts(host.id)).filter((run) => !previousRuns.has(run.id));
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1000 },
      colorScheme: 'light',
      reducedMotion: 'reduce',
    });
    const page = await context.newPage();
    const errors = [],
      requests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (
        request.url().startsWith(backend + '/ag-ui') &&
        request.method() === 'POST'
      )
        requests.push({ url: request.url(), body: request.postDataJSON() });
    });
    async function start(scenario) {
      previousRuns = new Set((await rawReceipts(host.id)).map((run) => run.id));
      await fetch(`${backend}/reset/${host.id}`, { method: 'POST' });
      await page.goto(host.url + '?scenario=' + scenario);
      await page.getByRole('textbox').fill(getScenario(scenario).prompt);
      await page.getByRole('textbox').press('Enter');
    }
    async function finished(scenario, status) {
      return until(
        () => receipt(host.id),
        (rows) =>
          rows.some(
            (row) => row.scenario === scenario && row.status === status
          ),
        `${host.id} ${scenario} ${status}`
      );
    }
    // Declared sources sit in the message's Sources panel, closed until opened.
    const signals = 'a[href="https://angular.dev/guide/signals"]';
    async function openSources() {
      const toggles = page.locator(
        '.chat-citations__header, .tp-citations__toggle'
      );
      await toggles.first().waitFor({ state: 'visible' });
      for (let index = 0; index < (await toggles.count()); index++) {
        const toggle = toggles.nth(index);
        if ((await toggle.getAttribute('aria-expanded')) === 'true') continue;
        await toggle.focus();
        await page.keyboard.press('Enter');
        // One press per panel: wait for it to report open before moving on.
        await page.waitForFunction(
          (el) => el.getAttribute('aria-expanded') === 'true',
          await toggle.elementHandle()
        );
      }
    }
    await start('references');
    await finished('references', 'complete');
    await openSources();
    const source = page.locator(signals).first();
    await source.waitFor({ state: 'visible' });
    const groups = page.locator(
      '.tp-tool-activity-group__details > summary, .ctc__group-header:not([hidden])'
    );
    assert.ok(await groups.count(), 'Grouped activity has a native disclosure');
    const group = groups.first();
    await group.focus();
    await page.keyboard.press('Enter');
    // The host may apply the toggle on its next render; observe it rather than race it.
    await until(
      () =>
        group.evaluate((el) =>
          el.tagName === 'SUMMARY'
            ? el.parentElement.open
            : el.getAttribute('aria-expanded') === 'true'
        ),
      (open) => open === true,
      'Enter opens group'
    );
    assert.equal(
      await group.evaluate((el) => document.activeElement === el),
      true,
      'Opening retains disclosure focus'
    );
    const details = page
      .locator('summary')
      .filter({ hasText: /^Details$/ })
      .first();
    await details.waitFor({ state: 'visible' });
    await details.focus();
    await page.keyboard.press('Space');
    assert.equal(
      await details.evaluate((el) => el.parentElement.open),
      true,
      'Space opens technical Details'
    );
    await source.waitFor({ state: 'visible' });
    assert.ok(
      await page
        .getByRole('button', { name: 'Copy to clipboard', exact: true })
        .count(),
      'Actual response Copy remains available'
    );
    await page.screenshot({
      path: join(output, `${host.id}-expanded-details.png`),
      fullPage: true,
    });
    await group.focus();
    await page.keyboard.press('Enter');
    await details.waitFor({ state: 'hidden' });
    await source.waitFor({ state: 'visible' });
    const links = await page.locator('main a').evaluateAll((nodes) =>
      nodes.map((node) => ({
        href: node.href,
        target: node.target,
        rel: node.rel,
      }))
    );
    assert.ok(
      links.every((link) => /^https?:\/\//.test(link.href)),
      'Outcome links use HTTP(S)'
    );
    assert.ok(
      links.every(
        (link) => link.target !== '_blank' || /noopener/.test(link.rel)
      ),
      'New windows are isolated'
    );
    const layouts = [];
    for (const [name, width, height, colorScheme] of [
      ['desktop', 1440, 1000, 'light'],
      ['dark', 1440, 1000, 'dark'],
      ['compact', 480, 900, 'light'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(250);
      const geometry = await page.evaluate(() => {
        const rect = (el) => {
          const r = el?.getBoundingClientRect();
          return r
            ? { x: r.x, y: r.y, width: r.width, height: r.height }
            : null;
        };
        return {
          viewport: [innerWidth, innerHeight],
          header: rect(document.querySelector('header')),
          main: rect(document.querySelector('main')),
          composer: rect(document.querySelector('textarea')),
          composerPill: rect(
            document.querySelector('.chat-input__pill, .tp-chat-input__pill')
          ),
          user: rect(
            document.querySelector(
              'chat-message[data-role=user] .chat-message__bubble, .tp-chat-message--user'
            )
          ),
          assistant: rect(
            document.querySelector(
              'chat-message[data-role=assistant] .chat-message__assistant-body, .tp-chat-message--assistant'
            )
          ),
          activity: rect(
            document.querySelector(
              '.ctc__group-header:not([hidden]), .tp-tool-activity-group__details > summary'
            )
          ),
          copy: rect(
            document.querySelector('button[aria-label="Copy to clipboard"]')
          ),
          horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
          liveRegions: [
            ...document.querySelectorAll('[aria-live], [role=status]'),
          ].map((el) => ({
            role: el.getAttribute('role'),
            live: el.getAttribute('aria-live'),
            text: el.textContent,
          })),
        };
      });
      assert.equal(
        geometry.horizontalOverflow,
        false,
        'No horizontal page overflow'
      );
      assert.ok(geometry.composer?.width > 0);
      layouts.push({
        name,
        geometry,
        accessibility: await page.locator('main').ariaSnapshot(),
      });
      await page.screenshot({
        path: join(output, `${host.id}-${name}.png`),
        fullPage: true,
      });
    }
    await page.emulateMedia({
      forcedColors: 'active',
      reducedMotion: 'reduce',
    });
    await group.focus();
    await page.keyboard.press('Enter');
    await details.waitFor({ state: 'visible' });
    await details.focus();
    const forcedColors = await details.evaluate((el) => ({
      outlineStyle: getComputedStyle(el).outlineStyle,
      outlineWidth: getComputedStyle(el).outlineWidth,
      active: document.activeElement === el,
    }));
    assert.equal(forcedColors.active, true);
    assert.notEqual(forcedColors.outlineStyle, 'none');
    const reducedMotion = await page
      .locator(
        '.tp-tool-activity__phase, .ctc__group-chevron, .tp-tool-activity-group__details > summary'
      )
      .evaluateAll((nodes) =>
        nodes.map((el) => {
          const style = getComputedStyle(el);
          return {
            className: el.className.baseVal ?? el.className,
            animationName: style.animationName,
            animationDuration: style.animationDuration,
            transitionDuration: style.transitionDuration,
            preference: matchMedia('(prefers-reduced-motion: reduce)').matches,
          };
        })
      );
    assert.ok(
      reducedMotion.length > 0,
      'Observed real tool presentation styles'
    );
    assert.ok(
      reducedMotion.every(
        (style) =>
          style.preference &&
          (style.animationName === 'none' ||
            style.animationDuration
              .split(',')
              .every((duration) => parseFloat(duration) <= 0.01))
      ),
      'Reduced-motion preference suppresses tool presentation animations'
    );
    assert.ok(
      reducedMotion.every((style) =>
        style.transitionDuration
          .split(',')
          .every((duration) => parseFloat(duration) <= 0.01)
      ),
      'Reduced-motion preference suppresses tool disclosure transitions'
    );
    await page.emulateMedia({ forcedColors: 'none' });

    for (const approved of [true, false]) {
      await start('native-approval');
      const paused = await finished('native-approval', 'paused');
      const pause = paused.at(-1);
      assert.ok(
        pause.tools.every((tool) => tool.executionCount === 0),
        'Pause does not execute save'
      );
      const action = page.getByRole('button', {
        name: approved ? 'Approve save' : 'Deny save',
        exact: true,
      });
      const pausedGroup = page.locator(groupToggle).first();
      await pausedGroup.click();
      await page
        .locator('summary')
        .filter({ hasText: /^Details$/ })
        .first()
        .click();
      await action.waitFor({ state: 'visible' });
      assert.ok(
        (await page.locator('[aria-live=polite]').allTextContents()).some(
          (text) => /waiting/i.test(text)
        ),
        'Native pending approval is presented as waiting'
      );
      await page.screenshot({
        path: join(
          output,
          `${host.id}-native-${approved ? 'approve' : 'deny'}.png`
        ),
        fullPage: true,
      });
      await action.focus();
      await page.keyboard.press('Enter');
      const rows = await finished(
        'native-approval',
        approved ? 'complete' : 'denied'
      );
      const resumed = rows.find((row) => row.sourceRunId === pause.nativeRunId);
      assert.ok(resumed, 'Resume is correlated to paused source run');
      assert.equal(resumed.threadId, pause.threadId);
      assert.equal(
        rows
          .flatMap((row) => row.tools)
          .reduce((n, tool) => n + tool.executionCount, 0),
        approved ? 1 : 0
      );
      const settledOutcome = page.getByText(
        approved
          ? /^Note note-[1-9]\d* in the local benchmark store\.$/
          : 'Save declined. No note was saved.',
        { exact: true }
      );
      await settledOutcome.waitFor({ state: 'visible' });
      await until(
        () =>
          page
            .getByRole('textbox')
            .evaluate((el) => el.ownerDocument.activeElement === el),
        (focused) => focused,
        'Composer regains focus after keyboard approval controls disappear'
      );
      const settledGroup = page.locator(groupToggle).first();
      if (
        await settledGroup.evaluate((el) =>
          el.matches('summary')
            ? el.parentElement.open
            : el.getAttribute('aria-expanded') === 'true'
        )
      ) {
        await settledGroup.click();
        await page
          .locator('summary')
          .filter({ hasText: /^Details$/ })
          .first()
          .waitFor({ state: 'hidden' });
      }
      await settledOutcome.waitFor({ state: 'visible' });
      await page.screenshot({
        path: join(
          output,
          `${host.id}-native-${approved ? 'approve' : 'deny'}-settled.png`
        ),
        fullPage: true,
      });
      const captured = requests
        .filter((request) => request.body.resume?.length)
        .at(-1);
      assert.ok(captured, 'Observed a real native resume request');
      const duplicate = await fetch(captured.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(captured.body),
      });
      assert.equal(duplicate.status, 409, 'Duplicate decision is rejected');
      evidence.push({
        host: host.id,
        scenario: 'native-approval',
        approved,
        receipts: rows,
        duplicateStatus: duplicate.status,
        composerFocusReturned: true,
        accessibility: await page.locator('main').ariaSnapshot(),
      });
    }
    await start('native-approval');
    await finished('native-approval', 'paused');
    const denyWithoutFocusReturn = page.getByRole('button', {
      name: 'Deny save',
      exact: true,
    });
    await denyWithoutFocusReturn.focus();
    await page.keyboard.press('Enter');
    const movedFocus = page.getByRole('button', {
      name: 'New conversation',
      exact: true,
    });
    await movedFocus.focus();
    await finished('native-approval', 'denied');
    await page
      .getByText('Save declined. No note was saved.', { exact: true })
      .waitFor({ state: 'visible' });
    assert.equal(
      await movedFocus.evaluate((el) => el.ownerDocument.activeElement === el),
      true,
      'Approval completion preserves focus moved to another control'
    );
    evidence.push({
      host: host.id,
      scenario: 'native-approval-focus-ownership',
      movedFocusPreserved: true,
    });
    // Save a real paused wire identity, then reset through the visible control.
    await start('native-approval');
    const old = (await finished('native-approval', 'paused')).at(-1);
    await page
      .getByRole('button', { name: 'Approve save', exact: true })
      .waitFor();
    const input = requests.filter((request) => !request.body.resume).at(-1);
    await Promise.all([
      page.waitForEvent('framenavigated', {
        predicate: (frame) => frame === page.mainFrame(),
      }),
      page
        .getByRole('button', { name: 'New conversation', exact: true })
        .click(),
    ]);
    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('textbox').waitFor();
    const stale = await fetch(input.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        ...input.body,
        runId: crypto.randomUUID(),
        resume: [
          { interruptId: old.interruptId, status: 'resolved', payload: true },
        ],
      }),
    });
    assert.equal(stale.status, 410, 'Reset rejects stale approval identity');
    assert.equal(
      await page
        .getByRole('button', { name: 'Approve save', exact: true })
        .count(),
      0
    );

    await start('partial-failure');
    const failedRows = await finished('partial-failure', 'error');
    const failed = failedRows.at(-1);
    // The declared failure is counted, and the successful read keeps its source.
    await page
      .getByText('Used 2 tools · 1 failed', { exact: true })
      .first()
      .waitFor({ state: 'visible' });
    await openSources();
    assert.ok(
      await page.locator(signals).count(),
      'Successful read keeps its source beside the failed read'
    );
    // The retry names its call and sits outside the collapsed Details.
    const retry = page.getByRole('button', {
      name: 'Retry array-to-sorted read',
      exact: true,
    });
    await retry.focus();
    await page.keyboard.press('Enter');
    const retriedRows = await finished('partial-failure', 'complete');
    const retried = retriedRows.find((row) => row.retryOf === failed.id);
    assert.ok(retried, 'Retry is backend-correlated');
    assert.equal(
      retried.threadId,
      failed.threadId,
      'Retry stays in the same thread'
    );
    assert.equal(
      retried.tools.length,
      1,
      'Successful prefix is not executed again'
    );
    assert.equal(retried.tools[0].canonicalId, 'read-sorted-retry');
    assert.notEqual(retried.tools[0].nativeId, failed.tools.at(-1).nativeId);
    assert.ok(
      await page.locator(signals).count(),
      'Successful prefix remains visible'
    );
    assert.equal(
      await retry.count(),
      0,
      'A superseded failed read stops offering retry'
    );

    await start('long-mixed');
    await until(
      () => receipt(host.id),
      (rows) =>
        rows.some(
          (row) =>
            row.scenario === 'long-mixed' &&
            row.tools.filter((tool) => tool.status === 'complete').length >= 5
        ),
      'long sequence begins'
    );
    const region = page.getByRole('region', {
      name: 'Conversation',
      exact: true,
    });
    const focusTarget = page.locator(groupToggle).first();
    await focusTarget.focus();
    await page.keyboard.press('Enter');
    await page
      .locator('.tp-tool-activity-group__items, .ctc__group-body:not([hidden])')
      .first()
      .waitFor({ state: 'visible' });
    await until(
      () => region.evaluate((el) => el.scrollHeight - el.clientHeight),
      // Angular deliberately follows within 150px of latest. Leave enough
      // history to move beyond that threshold, rather than treating a small
      // upward wheel within the follow tolerance as a detached reading state.
      (overflow) => overflow > 300,
      'Expanded long sequence exceeds the follow tolerance'
    );
    // Wheel through the real scroll surface: Angular distinguishes native
    // upward reading intent from its own pending programmatic scroll events.
    await region.hover();
    const readScroll = () =>
      region.evaluate((el) => ({
        top: el.scrollTop,
        max: el.scrollHeight - el.clientHeight,
      }));
    const nativeWheel = async (delta) => {
      // Register the listeners before sending the wheel. Racing the two lets a
      // loaded machine deliver the wheel first, and the gesture never settles.
      await region.evaluate((el, delta) => {
        el.wheelSettled = new Promise((resolve) => {
          let observedWheel = false;
          const onWheel = (event) => {
            if (event.isTrusted && Math.sign(event.deltaY) === Math.sign(delta))
              observedWheel = true;
          };
          const onEnd = (event) => {
            if (!observedWheel || event.target !== el) return;
            el.removeEventListener('wheel', onWheel);
            el.removeEventListener('scrollend', onEnd);
            resolve({
              trusted: event.isTrusted,
              top: el.scrollTop,
              max: el.scrollHeight - el.clientHeight,
            });
          };
          el.addEventListener('wheel', onWheel, { passive: true });
          el.addEventListener('scrollend', onEnd, { passive: true });
        });
      }, delta);
      await page.mouse.wheel(0, delta);
      return region.evaluate((el) => el.wheelSettled);
    };
    const initialLatest = await readScroll();
    // Do not queue opposite gestures: a still-coasting down wheel can restore
    // the bottom after the upward wheel even when SDK following is unpinned.
    const downGesture =
      initialLatest.max - initialLatest.top > 2
        ? await nativeWheel(100_000)
        : undefined;
    const wheelStart = await readScroll();
    assert.ok(
      wheelStart.top > 300 && wheelStart.max - wheelStart.top <= 2,
      `Native latest position before upward gesture: ${JSON.stringify({
        initialLatest,
        downGesture,
        wheelStart,
      })}`
    );
    const upGesture = await nativeWheel(-100_000);
    await until(
      () => region.evaluate((el) => el.scrollTop),
      (top) => top <= 1 && top < wheelStart.top,
      'Native upward wheel moves away from latest activity'
    );
    if (host.id === 'threadplane-angular')
      await page
        .getByRole('button', { name: /Scroll to latest/ })
        .waitFor({ state: 'visible' });
    const scrollBefore = await region.evaluate((el) => ({
      top: el.scrollTop,
      height: el.scrollHeight,
      client: el.clientHeight,
    }));
    const streamingBefore = (await receipt()).findLast(
      (row) => row.scenario === 'long-mixed'
    );
    assert.ok(
      streamingBefore?.status === 'running' &&
        streamingBefore.tools.length < getScenario('long-mixed').calls.length,
      `Reading baseline must precede unstarted tool work: ${JSON.stringify({
        status: streamingBefore?.status,
        startedTools: streamingBefore?.tools.length,
        expectedTools: getScenario('long-mixed').calls.length,
        scrollBefore,
      })}`
    );
    const longRows = await finished('long-mixed', 'partial');
    const scrollAfter = await region.evaluate((el) => ({
      top: el.scrollTop,
      height: el.scrollHeight,
      client: el.clientHeight,
    }));
    assert.ok(
      scrollBefore.height > scrollBefore.client,
      'Long workload overflows before streaming ends'
    );
    assert.ok(
      scrollAfter.height > scrollBefore.height,
      `Transcript must grow while reading position stays detached: ${JSON.stringify(
        { scrollBefore, scrollAfter }
      )}`
    );
    assert.ok(
      Math.abs(scrollAfter.top - scrollBefore.top) <= 2,
      `Reading position stays away from bottom while streaming: ${JSON.stringify(
        { wheelStart, scrollBefore, scrollAfter }
      )}`
    );
    assert.equal(
      await focusTarget.evaluate((el) => document.activeElement === el),
      true,
      'Disclosure identity retains focus through streaming'
    );
    const counts = await page.locator('[aria-live=polite]').allTextContents();
    assert.ok(
      counts.every(
        (text) => !text.includes('"query"') && !text.includes('"summary"')
      ),
      'Live regions do not announce raw tool payloads'
    );
    await start('slow');
    await page.getByRole('button', { name: /Stop/ }).first().click();
    await finished('slow', 'aborted');
    assert.deepEqual(errors, [], 'No uncaught browser errors');
    evidence.push({
      host: host.id,
      scenario: 'layout-and-recovery',
      layouts,
      forcedColors,
      reducedMotion,
      links,
      staleStatus: stale.status,
      retryReceipts: retriedRows,
      longReceipts: longRows,
      scrollBefore,
      scrollAfter,
      wheelStart,
      initialLatest,
      downGesture,
      upGesture,
      streamingBefore,
      counts,
      errors,
    });
    await context.close();
  }
} finally {
  writeFileSync(
    join(output, 'native-evidence.json'),
    JSON.stringify(
      {
        evidence,
        limitations: [
          'Browser accessibility structure and live-region contents checked; actual screen-reader speech requires manual assistive-technology testing.',
          'No vendor-native approval comparison: legacy run-live.mjs remains a separate backend-contract check.',
          'Stale and duplicate wire requests replay captured real identities to test backend fencing; transcript/session state is never injected.',
        ],
      },
      null,
      2
    ) + '\n'
  );
  await browser.close();
}
console.log(JSON.stringify({ output, checks: evidence.length }));
