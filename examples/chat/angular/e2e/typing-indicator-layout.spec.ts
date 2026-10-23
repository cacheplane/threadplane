import { test, expect, type Locator } from '@playwright/test';
import {
  messageInput,
  openDemo,
  sendButton,
  waitForFinalAssistant,
} from './test-helpers';

async function expectNoTypingHostGeometry(hosts: Locator): Promise<void> {
  // The primitive may remain mounted while idle. Its empty host must not
  // reserve space; normal transcript padding is independent of this check.
  await expect
    .poll(() =>
      hosts.evaluateAll((elements) =>
        elements.every((element) => {
          const { width, height } = element.getBoundingClientRect();
          return width === 0 && height === 0;
        }),
      ),
    )
    .toBe(true);
}

test('idle typing host does not add layout space before or after streaming', async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  await openDemo(page, '/embed');
  await expect(messageInput(page)).toBeVisible();

  const hosts = page.locator('embed-mode chat chat-typing-indicator');
  const typing = hosts.getByRole('status', { name: 'Assistant is typing' });

  // The welcome screen has no transcript or typing primitive yet.
  await expect(hosts).toHaveCount(0);
  await expect(typing).toBeHidden();
  await expectNoTypingHostGeometry(hosts);

  // The composition suppresses the floor indicator for assistant streaming
  // delivery regardless of content. Cover its idle/stream/completed lifecycle;
  // standalone primitive visibility transitions are covered by rendered unit tests.
  await messageInput(page).fill('stream a long deterministic answer');
  await sendButton(page).click();

  const streamingAssistant = page
    .locator('chat-message[data-role="assistant"][data-streaming="true"]')
    .last();
  await expect(streamingAssistant).toContainText('Streaming smoke response begins');
  await expect(typing).toBeHidden();
  await expectNoTypingHostGeometry(hosts);

  const finishedAssistant = await waitForFinalAssistant(page);
  await expect(finishedAssistant).toContainText('Final marker: complete.');
  await expect(sendButton(page)).toBeDisabled();
  await expect(hosts).toHaveCount(1);
  await expect(typing).toBeHidden();
  const idleLayout = await hosts.evaluate((host) => {
    const scroll = host.closest('.chat-scroll');
    if (!scroll) throw new Error('Typing host must belong to the chat scroll container');
    const rect = host.getBoundingClientRect();
    const originalStyle = host.getAttribute('style');
    const scrollHeightBefore = scroll.scrollHeight;
    try {
      (host as HTMLElement).style.setProperty('display', 'none', 'important');
      return {
        hostWidth: rect.width,
        hostHeight: rect.height,
        scrollClientHeight: scroll.clientHeight,
        scrollHeightBefore,
        scrollHeightWithHostDisplayNone: scroll.scrollHeight,
      };
    } finally {
      if (originalStyle === null) host.removeAttribute('style');
      else host.setAttribute('style', originalStyle);
    }
  });
  await testInfo.attach('typing-indicator-idle-layout.json', {
    body: JSON.stringify(idleLayout, null, 2),
    contentType: 'application/json',
  });
  expect(idleLayout.scrollHeightWithHostDisplayNone).toBe(idleLayout.scrollHeightBefore);
  await expectNoTypingHostGeometry(hosts);
});
