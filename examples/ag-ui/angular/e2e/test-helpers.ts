import { expect, type Locator, type Page } from '@playwright/test';

export function attachBrowserHygiene(page: Page): {
  consoleErrors: string[];
  failedRequests: string[];
} {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg) => {
    if (msg.type() !== 'error') return;
    const text = msg.text();
    if (
      /PostHog|ERR_NAME_NOT_RESOLVED|ERR_CONNECTION_RESET/i.test(text)
    )
      return;
    consoleErrors.push(text);
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(err.message);
  });
  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText ?? '';
    const url = request.url();
    if (/runs\/stream|\/agent/.test(url) && /abort|ERR_ABORTED/i.test(failure))
      return;
    failedRequests.push(`${request.method()} ${url} ${failure}`.trim());
  });

  return { consoleErrors, failedRequests };
}

export async function openDemo(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.goto(path);
}

export function messageInput(page: Page): Locator {
  return page.getByRole('textbox', { name: /type a message|message|prompt/i });
}

export function sendButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Send message' });
}

/**
 * Read the active thread id from the URL. URL is the source of truth
 * for the active thread post-URL-as-truth migration; bare-mode paths
 * (`/embed`, `/popup`, `/sidebar`) return `null`.
 *
 * Use this in place of `JSON.parse(localStorage.getItem(...)).threadId`,
 * which no longer exists.
 */
export async function activeThreadIdFromUrl(
  page: Page
): Promise<string | null> {
  const url = new URL(page.url());
  const segments = url.pathname.split('/').filter(Boolean);
  return segments.length >= 2 ? segments[1] : null;
}

/**
 * Locate the chat-select trigger inside a toolbar field by its label.
 *
 * The toolbar's four dropdowns (Model, Effort, Gen UI, Theme) use the
 * @threadplane/chat `chat-select` primitive — not native <select>. The trigger
 * is the button users click to open the popover.
 *
 * After PR #444 dropped the visible label text from the toolbar, the
 * fields are now identified by stable `data-field` attributes on the
 * `.ag-ui-shell__field` wrapper. The label argument is mapped to the
 * matching attribute value so call sites stay unchanged.
 */
const LABEL_TO_FIELD: Record<string, string> = {
  Model: 'model',
  Effort: 'effort',
  'Gen UI': 'genui',
  Theme: 'theme',
};

function labelToFieldAttr(label: string): string {
  return LABEL_TO_FIELD[label] ?? label.toLowerCase().replace(/\s+/g, '');
}

export function toolbarSelect(page: Page, label: string): Locator {
  const field = labelToFieldAttr(label);
  return page
    .locator(`.ag-ui-shell__field[data-field="${field}"]`)
    .locator('chat-select .chat-select__trigger');
}

/**
 * Open the named chat-select dropdown in the toolbar and click the option
 * whose visible label matches `option`. Replaces the previous
 * `selectOption({ label })` call against native <select> elements.
 *
 * Waits for the menu to be visible before clicking the option so the
 * click doesn't race the menu mount.
 */
export async function selectToolbarOption(
  page: Page,
  label: string,
  option: string
): Promise<void> {
  const trigger = toolbarSelect(page, label);
  await trigger.click();
  // chat-select renders its menu through the chat connected-overlay primitive
  // (body portal), so the menu is in .chat-overlay-container, not inside
  // <chat-select>. Only one select menu is open at a time in this flow.
  const menu = page.locator('.chat-overlay-container .chat-select__menu');
  await menu.waitFor({ state: 'visible' });
  const optionButton = menu
    .locator('.chat-select__option')
    .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(option)}\\s*$`) });
  await optionButton.click();
  // Menu closes on selection; wait for that to avoid racing the next open.
  await menu.waitFor({ state: 'hidden' });
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function isVisible(locator: Locator): Promise<boolean> {
  try {
    return await locator.first().isVisible();
  } catch {
    return false;
  }
}

export async function openChatDevtools(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: 'Chat devtools' });
  const launcher = page.getByRole('button', { name: 'Open chat devtools' });

  await expect
    .poll(
      async () => (await isVisible(region)) || (await isVisible(launcher)),
      {
        timeout: 5_000,
      }
    )
    .toBe(true);

  if (await isVisible(region)) return;

  await launcher.first().click();
  await expect(region).toBeVisible();
}

export async function closeChatDevtools(page: Page): Promise<void> {
  const region = page.getByRole('region', { name: 'Chat devtools' });
  const launcher = page.getByRole('button', { name: 'Open chat devtools' });

  await expect
    .poll(
      async () => (await isVisible(region)) || (await isVisible(launcher)),
      {
        timeout: 5_000,
      }
    )
    .toBe(true);

  if (!(await isVisible(region))) return;

  const close = page
    .locator('chat-debug')
    .getByRole('button', { name: 'Close' });
  await close.first().click();
  await expect(region).toHaveCount(0);
  await expect(launcher.first()).toBeVisible();
}

export async function waitForFinalAssistant(page: Page): Promise<Locator> {
  const finalizedAssistant = page
    .locator('chat-message[data-role="assistant"][data-streaming="false"]')
    .last();
  await expect(finalizedAssistant).toBeAttached({ timeout: 45_000 });
  await expect
    .poll(
      async () => ((await finalizedAssistant.innerText()) ?? '').trim().length,
      {
        timeout: 30_000,
      }
    )
    .toBeGreaterThan(0);
  return finalizedAssistant;
}

/**
 * Send a user prompt and wait for the assistant bubble to finalize.
 *
 * "Finalized" means `chat-message[data-role="assistant"][data-streaming="false"]`.
 * The attribute reflects the message's authoritative delivery phase and flips
 * only when the adapter completes that message generation.
 *
 * Use this helper for final-state assertions. Tests that intentionally verify
 * progressive rendering should sample the streaming message directly.
 */
export async function sendPromptAndWait(
  page: Page,
  prompt: string
): Promise<Locator> {
  await openDemo(page, '/');
  const input = messageInput(page);
  await input.fill(prompt);
  await sendButton(page).click();

  return waitForFinalAssistant(page);
}
