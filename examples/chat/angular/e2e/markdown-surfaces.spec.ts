import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  attachBrowserHygiene,
  messageInput,
  openDemo,
  sendButton,
  sendPromptAndWait,
  waitForFinalAssistant,
} from './test-helpers';

test('heading: assistant bubble renders an <h1>', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, 'respond with a heading');
  await expect(bubble.locator('h1')).toBeVisible();
  await expect(bubble.locator('h1')).toContainText(/heading one/i);
});

test('code fence: assistant bubble renders <pre><code>', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, 'respond with a code fence');
  const codeBlock = bubble.locator('pre code');
  await expect(codeBlock).toBeVisible();
  await expect(codeBlock).toContainText('const answer = 42');
});

test('bullet list: assistant bubble renders <ul> with three <li>', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, 'respond with a bullet list');
  const list = bubble.locator('ul');
  await expect(list).toBeVisible();
  await expect(list.locator('li')).toHaveCount(3);
  await expect(list.locator('li').nth(0)).toContainText('alpha');
  await expect(list.locator('li').nth(1)).toContainText('beta');
  await expect(list.locator('li').nth(2)).toContainText('gamma');
});

test('ordinary list paragraphs share the marker line through Angular wrappers', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, 'respond with a bullet list');
  const items = bubble.locator('li:not(.chat-md-list-item--task)');
  await expect(items.first()).toBeVisible();
  const geometry = await items.evaluateAll((elements) => elements.map((item) => {
    const paragraph = item.querySelector(':scope > chat-md-children > chat-md-paragraph:first-child > p');
    if (!paragraph) throw new Error('Expected a paragraph rendered through Angular list wrappers');
    const itemBounds = item.getBoundingClientRect();
    const paragraphBounds = paragraph.getBoundingClientRect();
    return {
      paragraphOffset: paragraphBounds.top - itemBounds.top,
      // A single paragraph must not acquire an empty marker-only line in Firefox.
      extraHeight: itemBounds.height - paragraphBounds.height,
    };
  }));
  expect(geometry.length).toBeGreaterThan(1);
  for (const item of geometry) {
    expect(Math.abs(item.paragraphOffset)).toBeLessThan(1);
    expect(Math.abs(item.extraHeight)).toBeLessThan(1);
  }
});

test('markdown checklist matrix: rich markdown renders with escaped html', async ({ page }) => {
  const bubble = await sendPromptAndWait(page, 'respond with the markdown checklist kitchen sink');

  await expect(bubble.locator('h1')).toContainText('Heading One');
  await expect(bubble.locator('h2')).toContainText('Heading Two');
  await expect(bubble.locator('h3')).toContainText('Heading Three');
  await expect(bubble.locator('strong')).toContainText('bold text');
  await expect(bubble.locator('em')).toContainText('italic text');
  await expect(bubble.locator('p code')).toContainText('inline code');
  await expect(bubble.locator('ul').first()).toContainText('parent item');
  await expect(bubble.locator('ul').first()).toContainText('nested child');
  await expect(bubble.locator('ul').first()).toContainText('second parent');
  await expect(bubble.locator('ol li')).toHaveText(['first ordered', 'second ordered']);
  await expect(bubble.locator('input[type="checkbox"]')).toHaveCount(2);
  await expect(bubble.locator('code').filter({ hasText: 'const answer = 42' })).toBeVisible();
  await expect(bubble.locator('table')).toBeVisible();
  await expect(bubble.locator('thead th')).toHaveText(['Name', 'Mental model', 'When to use']);
  await expect(bubble.locator('tbody tr')).toHaveCount(2);
  await expect.poll(async () => tableColumnsAlign(bubble)).toBe(true);
  await expect(bubble.locator('blockquote')).toBeVisible();
  await expect(bubble).toContainText('This is a blockquote.');
  await expect(bubble.locator('a', { hasText: 'Angular' })).toHaveAttribute(
    'href',
    'https://angular.dev',
  );
  await expect(bubble.locator('hr')).toBeVisible();
  await expect(bubble.locator('script')).toHaveCount(0);
  await expect(bubble).toContainText("<script>alert('xss')</script>");
});

test('blockquote followed by table stays in one rendered markdown surface', async ({ page }) => {
  const bubble = await sendPromptAndWait(
    page,
    'Give me a blockquote with two lines, then a markdown table with columns issue, expected behavior, verification.',
  );

  await expect(bubble.locator('blockquote')).toHaveCount(1);
  await expect(bubble.locator('blockquote')).toContainText('First quoted line');
  await expect(bubble.locator('blockquote')).toContainText('Second quoted line');
  await expect(bubble.locator('table')).toHaveCount(1);
  await expect(bubble.locator('thead th')).toHaveText([
    'Issue',
    'Expected behavior',
    'Verification',
  ]);
  await expect(bubble.locator('tbody tr')).toHaveCount(3);
  await expect.poll(async () => tableColumnsAlign(bubble)).toBe(true);
  await expect(
    bubble.locator('p').filter({ hasText: /\|/ }),
    'table rows should not render as raw pipe paragraphs',
  ).toHaveCount(0);
});

test('streaming markdown table: keeps in-progress rows inside one table', async ({ page }) => {
  const hygiene = attachBrowserHygiene(page);
  await sendPrompt(page, 'stream a markdown comparison table regression');

  const streamingAssistant = latestAssistant(page);
  await expect(streamingAssistant).toBeAttached({ timeout: 15_000 });

  const samples = await collectStreamingSamples(page, streamingAssistant, 2_000);
  expect(contentChangedAcross(samples)).toBe(true);
  const tableSamples = samples.filter((sample) => sample.tableCount > 0);
  expect(tableSamples.length).toBeGreaterThan(2);
  expect(tableSamples.every((sample) => sample.tableCount <= 1)).toBe(true);
  expect(tableSamples.every((sample) => sample.rowsOutsideTable === 0)).toBe(true);
  expect(tableSamples.every((sample) => sample.detachedTableCellText.length === 0)).toBe(true);

  const bubble = await waitForFinalAssistant(page);
  await expect(bubble.locator('table')).toHaveCount(1);
  await expect(bubble.locator('thead th')).toHaveText(['Name', 'Mental model', 'When to use']);
  await expect(bubble.locator('tbody tr')).toHaveCount(3);
  await expect(bubble.locator('tbody tr').nth(2)).toContainText('zone.js');
  await expect.poll(async () => tableColumnsAlign(bubble)).toBe(true);
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});

test('streaming markdown table: blockquote followed by table does not throw', async ({ page }) => {
  const hygiene = attachBrowserHygiene(page);
  await sendPrompt(page, 'stream a blockquote then a markdown table regression');

  const streamingAssistant = latestAssistant(page);
  await expect(streamingAssistant).toBeAttached({ timeout: 15_000 });
  await waitForStreamingContent(streamingAssistant);

  const samples = await collectStreamingSamples(page, streamingAssistant, 2_000);
  const bubble = await waitForFinalAssistant(page);

  expect(contentChangedAcross(samples)).toBe(true);
  const firstTableSample = samples.findIndex((sample) => sample.tableCount > 0);
  expect(firstTableSample).toBeGreaterThanOrEqual(0);
  const samplesAfterTableAppears = samples.slice(firstTableSample);
  expect(samplesAfterTableAppears.length).toBeGreaterThan(2);
  expect(tableBoundaryViolations(samplesAfterTableAppears)).toEqual([]);

  await expect(bubble.locator('blockquote')).toBeVisible();
  await expect(bubble.locator('blockquote')).toContainText('First line of the quote.');
  await expect(bubble.locator('blockquote')).toContainText('Second line of the quote.');
  await expect(bubble.locator('table')).toHaveCount(1);
  await expect(bubble.locator('thead th')).toHaveText([
    'Issue',
    'Expected behavior',
    'Verification',
  ]);
  await expect(bubble.locator('tbody tr')).toHaveCount(2);
  await expect.poll(async () => tableColumnsAlign(bubble)).toBe(true);
  await expect(
    bubble.locator('p').filter({ hasText: /\|/ }),
    'table rows should not render as raw pipe paragraphs',
  ).toHaveCount(0);
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});

test('streaming markdown table: long pause after header has no detached table state', async ({
  page,
}) => {
  const hygiene = attachBrowserHygiene(page);
  await sendPrompt(page, 'stream a markdown table with a long header pause regression');

  const streamingAssistant = latestAssistant(page);
  await expect(streamingAssistant).toBeAttached({ timeout: 15_000 });
  await waitForStreamingContent(streamingAssistant);

  const samples = await collectStreamingSamples(page, streamingAssistant, 2_000);
  const bubble = await waitForFinalAssistant(page);

  expect(samples.length).toBeGreaterThan(20);
  expect(samples[0]?.contentTextLength).toBeGreaterThan(0);
  expect(samples.every((sample) => sample.tableCount <= 1)).toBe(true);
  expect(samples.every((sample) => sample.tableElementsOutsideTable === 0)).toBe(true);
  expect(samples.every((sample) => sample.detachedTableCellText.length === 0)).toBe(true);
  expect(samples.every((sample) => sample.rawPipeTextOutsideTable.length === 0)).toBe(true);

  await expect(bubble.locator('table')).toHaveCount(1);
  await expect(bubble.locator('thead th')).toHaveText(['Name', 'Value']);
  await expect(bubble.locator('tbody tr')).toHaveCount(2);
  await expect(bubble.locator('tbody tr')).toContainText(['alpha', 'beta']);
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});

test('streaming thematic break suppresses the live markdown delimiter', async ({ page }) => {
  const hygiene = attachBrowserHygiene(page);
  await sendPrompt(page, 'stream a thematic break regression');

  const streamingAssistant = latestAssistant(page);
  await expect(streamingAssistant).toBeAttached({ timeout: 15_000 });
  await waitForStreamingContent(streamingAssistant);

  const samples = await collectStreamingSamples(page, streamingAssistant, 1_200);
  const bubble = await waitForFinalAssistant(page);

  expect(samples.length).toBeGreaterThan(2);
  expect(samples.some((sample) => sample.thematicBreakCount > 0)).toBe(true);
  expect(
    samples.every(
      (sample) => sample.rawThematicBreakTextOutsideCode.length === 0,
    ),
  ).toBe(true);

  await expect(bubble.locator('hr')).toHaveCount(1);
  await expect(bubble).toContainText('Before the break.');
  await expect(bubble).toContainText('After the break.');
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});

test('streaming code fence: suppresses closing fence marker while streaming', async ({ page }) => {
  const hygiene = attachBrowserHygiene(page);
  await sendPrompt(page, 'stream a TypeScript code fence regression');

  const streamingAssistant = latestAssistant(page);
  await expect(streamingAssistant).toBeAttached({ timeout: 15_000 });

  const samples = await collectStreamingSamples(page, streamingAssistant, 4_000);
  expect(contentChangedAcross(samples)).toBe(true);
  const codeSamples = samples.filter((sample) => sample.codeBlockCount > 0);
  expect(codeSamples.length).toBeGreaterThan(2);
  expect(codeSamples.every((sample) => !sample.hasRawFenceMarker)).toBe(true);

  const bubble = await waitForFinalAssistant(page);
  await expect(bubble.locator('pre code')).toHaveCount(1);
  await expect(bubble.locator('pre code')).toContainText('const answer = 42');
  expect(await bubbleContainsRawFenceMarker(bubble)).toBe(false);
  expect(hygiene.consoleErrors).toEqual([]);
  expect(hygiene.failedRequests).toEqual([]);
});

async function tableColumnsAlign(bubble: Locator): Promise<boolean> {
  const table = bubble.locator('table').first();
  return table.evaluate((el) => {
    const headerCells = Array.from(el.querySelectorAll('thead th'));
    const rows = Array.from(el.querySelectorAll('tbody tr'));
    if (headerCells.length === 0 || rows.length === 0) return false;

    const headerLefts = headerCells.map((cell) => cell.getBoundingClientRect().left);
    return rows.every((row) => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length !== headerLefts.length) return false;
      return cells.every((cell, index) => (
        Math.abs(cell.getBoundingClientRect().left - headerLefts[index]) <= 1
      ));
    });
  });
}

async function sendPrompt(page: Page, prompt: string): Promise<void> {
  await openDemo(page, '/embed');
  await messageInput(page).fill(prompt);
  await sendButton(page).click();
}

function latestAssistant(page: Page): Locator {
  return page.locator('chat-message[data-role="assistant"]').last();
}

interface StreamingMarkdownSample {
  readonly contentTextLength: number;
  readonly tableCount: number;
  readonly rowsOutsideTable: number;
  readonly detachedTableCellText: string[];
  readonly tableElementsOutsideTable: number;
  readonly rawPipeTextOutsideTable: string[];
  readonly tableFollowsBlockquote: boolean;
  readonly tableNestedInBlockquote: boolean;
  readonly codeBlockCount: number;
  readonly hasRawFenceMarker: boolean;
  readonly thematicBreakCount: number;
  readonly rawThematicBreakTextOutsideCode: string[];
}

async function collectStreamingSamples(
  page: Page,
  bubble: Locator,
  minimumDurationMs: number,
): Promise<StreamingMarkdownSample[]> {
  const samples: StreamingMarkdownSample[] = [];
  const startedAt = Date.now();

  do {
    samples.push(await sampleStreamingMarkdown(bubble));
    await page.waitForTimeout(75);
  } while (Date.now() - startedAt < minimumDurationMs);

  return samples;
}

async function waitForStreamingContent(bubble: Locator): Promise<void> {
  await expect.poll(async () => (
    await sampleStreamingMarkdown(bubble)
  ).contentTextLength, {
    intervals: [25],
    timeout: 15_000,
  }).toBeGreaterThan(0);
}

async function sampleStreamingMarkdown(bubble: Locator): Promise<StreamingMarkdownSample> {
  return bubble.evaluate((el) => {
    const looksLikeTableRowFragment = (text: string): boolean => (
      /\|/.test(text) || /Angular Signals|RxJS|zone\.js/.test(text)
    );
    const tables = Array.from(el.querySelectorAll('table'));
    const blockquote = el.querySelector('blockquote');
    const table = tables[0];
    const rowsOutsideTable = Array.from(el.querySelectorAll('tr')).filter(
      (row) => !row.closest('table'),
    ).length;
    const tableElementsOutsideTable = Array.from(el.querySelectorAll('tr, th, td')).filter(
      (tableElement) => !tableElement.closest('table'),
    ).length;
    const detachedTableCellText: string[] = [];
    const rawPipeTextOutsideTable: string[] = [];
    const rawThematicBreakTextOutsideCode: string[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const parent = node.parentElement;
      const text = node.textContent?.trim() ?? '';
      if (text && !parent?.closest('table') && looksLikeTableRowFragment(text)) {
        detachedTableCellText.push(text);
      }
      if (text.includes('|') && !parent?.closest('table, pre, code')) {
        rawPipeTextOutsideTable.push(text);
      }
      if (
        !parent?.closest('pre, code')
        && /(^|\n)\s*(?:-{3,}|\*{3,}|_{3,})\s*(?=\n|$)/.test(node.textContent ?? '')
      ) {
        rawThematicBreakTextOutsideCode.push(text);
      }
      node = walker.nextNode();
    }

    return {
      contentTextLength: el.textContent?.length ?? 0,
      tableCount: tables.length,
      rowsOutsideTable,
      detachedTableCellText,
      tableElementsOutsideTable,
      rawPipeTextOutsideTable,
      tableFollowsBlockquote: Boolean(
        blockquote
        && table
        && Boolean(blockquote.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING),
      ),
      tableNestedInBlockquote: Boolean(table?.closest('blockquote')),
      codeBlockCount: el.querySelectorAll('pre code').length,
      hasRawFenceMarker: el.textContent?.includes('```') ?? false,
      thematicBreakCount: el.querySelectorAll('hr').length,
      rawThematicBreakTextOutsideCode,
    };
  });
}

async function bubbleContainsRawFenceMarker(bubble: Locator): Promise<boolean> {
  return bubble.evaluate((el) => el.textContent?.includes('```') ?? false);
}

function contentChangedAcross(samples: StreamingMarkdownSample[]): boolean {
  return new Set(samples.map((sample) => sample.contentTextLength)).size > 2;
}

function tableBoundaryViolations(samples: StreamingMarkdownSample[]): object[] {
  return samples.flatMap((sample, index) => {
    const valid = sample.tableCount === 1
      && sample.tableElementsOutsideTable === 0
      && sample.rawPipeTextOutsideTable.length === 0
      && sample.tableFollowsBlockquote
      && !sample.tableNestedInBlockquote;
    if (valid) return [];

    return [{
      sampleIndex: index,
      tableCount: sample.tableCount,
      tableElementsOutsideTable: sample.tableElementsOutsideTable,
      rawPipeTextOutsideTable: sample.rawPipeTextOutsideTable,
      tableFollowsBlockquote: sample.tableFollowsBlockquote,
      tableNestedInBlockquote: sample.tableNestedInBlockquote,
    }];
  });
}
