import {test, expect} from '@playwright/test';
import {
  attachBrowserHygiene,
  messageInput,
  openDemo,
  sendButton,
  waitForFinalAssistant,
} from './test-helpers';

test.describe.configure({retries: 0});
test.use({trace: 'off'});

interface WheelObservation {
  trusted: boolean;
  deltaY: number;
  defaultPrevented: boolean | null;
}

declare global {
  interface Window {
    __scrollInterruptionWheel?: WheelObservation[];
  }
}

// Unreleased checkout validation against the existing local replay fixture.
// This is a browser behavior regression, not a benchmark or frame measurement.
test('scroll interruption: trusted history scroll survives later tokens and native return', async ({page}) => {
  const prompt = 'stream a long deterministic answer';
  await openDemo(page, '/embed');
  const hygiene = attachBrowserHygiene(page);
  await messageInput(page).fill(prompt);
  await sendButton(page).click();

  await waitForFinalAssistant(page);
  const history = page.locator('embed-mode chat chat-message[data-role="assistant"]').first();
  const historyContent = history.locator('chat-streaming-md').first();
  await expect(historyContent).toContainText('Final marker: complete.');
  const historyText = await historyContent.textContent();
  const historyNode = await history.elementHandle();
  if (!historyNode) throw new Error('Completed historical message absent');

  // Keep the same real thread. sendPromptAndWait would reset the demo storage.
  await messageInput(page).fill(prompt);
  await sendButton(page).click();
  const assistants = page.locator('embed-mode chat chat-message[data-role="assistant"]');
  await expect(assistants).toHaveCount(2);
  const current = assistants.nth(1);
  const currentContent = current.locator('chat-streaming-md').first();
  await expect(current).toHaveAttribute('data-streaming', 'true');
  await expect.poll(async () => (await currentContent.textContent())?.length ?? 0).toBeGreaterThanOrEqual(512);
  await expect(current).toHaveAttribute('data-streaming', 'true');

  const scroll = page.locator('embed-mode chat .chat-scroll');
  await expect(scroll).toHaveCount(1);
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.clientHeight)).toBeGreaterThan(150);
  const box = await scroll.boundingBox();
  if (!box) throw new Error('Native transcript scroller absent');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
  await scroll.evaluate(node => {
    const observations: WheelObservation[] = [];
    window.__scrollInterruptionWheel = observations;
    node.addEventListener('wheel', event => {
      const wheel = event as WheelEvent;
      const row: WheelObservation = {trusted: wheel.isTrusted, deltaY: wheel.deltaY, defaultPrevented: null};
      observations.push(row);
      // Read after the entire event dispatch, including later bubble listeners.
      setTimeout(() => { row.defaultPrevented = wheel.defaultPrevented; }, 0);
    }, {capture: true, passive: true});
  });

  const beforeTop = await scroll.evaluate(node => node.scrollTop);
  await expect(current).toHaveAttribute('data-streaming', 'true');
  await page.mouse.wheel(0, -600);
  await expect.poll(() => scroll.evaluate(node => node.scrollTop)).toBeLessThan(beforeTop - 1);
  await expect.poll(() => page.evaluate(() => {
    const events = window.__scrollInterruptionWheel;
    return events?.length === 1 && events[0].defaultPrevented !== null;
  })).toBe(true);
  expect(await page.evaluate(() => window.__scrollInterruptionWheel)).toEqual([
    {trusted: true, deltaY: -600, defaultPrevented: false},
  ]);

  const historicalState = () => historyNode.evaluate(node => {
    const scroller = node.closest('.chat-scroll');
    const content = node.querySelector('chat-streaming-md');
    const sameNode = node.isConnected && node === document.querySelector('embed-mode chat chat-message[data-role="assistant"]');
    const historical = node.getAttribute('data-current') === 'false';
    if (!(scroller instanceof HTMLElement) || !(content instanceof HTMLElement)
      || !content.checkVisibility({contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true})) {
      return {sameNode, historical, visible: false};
    }
    const box = scroller.getBoundingClientRect(), rect = content.getBoundingClientRect();
    const left = Math.max(0, box.left + scroller.clientLeft), top = Math.max(0, box.top + scroller.clientTop);
    const right = Math.min(innerWidth, box.left + scroller.clientLeft + scroller.clientWidth);
    const bottom = Math.min(innerHeight, box.top + scroller.clientTop + scroller.clientHeight);
    return {sameNode, historical, visible: Math.min(rect.right, right) > Math.max(rect.left, left)
      && Math.min(rect.bottom, bottom) > Math.max(rect.top, top)};
  });
  await expect.poll(historicalState).toEqual({sameNode: true, historical: true, visible: true});

  // Observe two genuine later text advances while the original reply is active.
  let previousCharacters = (await currentContent.textContent())?.length ?? 0;
  for (let advance = 0; advance < 2; advance++) {
    await expect.poll(async () => (await currentContent.textContent())?.length ?? 0).toBeGreaterThan(previousCharacters);
    previousCharacters = (await currentContent.textContent())?.length ?? 0;
    await expect(current).toHaveAttribute('data-streaming', 'true');
    expect(await historicalState()).toEqual({sameNode: true, historical: true, visible: true});
  }
  await expect(current).toHaveAttribute('data-streaming', 'false');
  await expect(currentContent).toContainText('Final marker: complete.');
  expect(await historicalState()).toEqual({sameNode: true, historical: true, visible: true});
  expect(await historyContent.textContent()).toBe(historyText);

  const returnControl = page.getByRole('button', {name: 'Scroll to latest', exact: true});
  await expect(returnControl).toBeVisible();
  await returnControl.click();
  await expect.poll(() => scroll.evaluate(node => node.scrollHeight - node.scrollTop - node.clientHeight)).toBeLessThanOrEqual(4);
  await expect(returnControl).toBeHidden();
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});
