import { expect, type Locator } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { test } from './fixtures';

const answer = `# Visual review

This is the same response in both frameworks, with **bold text**, *emphasis*, and \`inline code\`.

## Next steps

- Review the proposal
- Confirm the remaining details

- [x] Proposal reviewed
- [ ] Decision pending

| Item | Status |
| --- | --- |
| Proposal | Reviewed |
| Decision | Pending |

\`\`\`ts
const answer = 42;
\`\`\`

> Keep the context before choosing an action.
`;

async function expectUnobstructed(input: Locator) {
  await expect
    .poll(() =>
      input.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const points = [
          [r.x + r.width / 2, r.y + r.height / 2],
          [r.left + 2, r.top + 2],
          [r.right - 2, r.top + 2],
          [r.left + 2, r.bottom - 2],
          [r.right - 2, r.bottom - 2],
        ];
        return (
          r.width > 0 &&
          r.height > 0 &&
          r.left >= 0 &&
          r.top >= 0 &&
          r.right <= innerWidth &&
          r.bottom <= innerHeight &&
          points.every(([x, y]) => document.elementFromPoint(x, y) === element)
        );
      })
    )
    .toBe(true);
}

for (const width of [375, 1280])
  for (const theme of ['light', 'dark'] as const) {
    test(`native visual contract: ${width}px ${theme}`, async ({
      page,
      retainedConsumer,
    }, testInfo) => {
      const { selectedFramework } = await import('../tooling/commands.mjs');
      const framework = selectedFramework(testInfo.project.metadata.framework);
      const { startProofServer, threadEnvelope } = await import(
        '../tooling/proof-server.mjs'
      );
      const { startCheckedServer } = await import(
        '../tooling/retained-build.mjs'
      );
      const thread = threadEnvelope('visual', 'Visual review');
      const toolThread = threadEnvelope('tool-output', 'Tool output check');
      const messages = [
        {
          id: 'question',
          type: 'human',
          content: 'Show the visual comparison fixture.',
        },
        { id: 'answer', type: 'ai', content: answer },
      ];
      const toolMessage = {
        id: 'tool-result',
        type: 'tool',
        tool_call_id: 'observed-tool',
        content:
          'Long tool output:\n' +
          Array.from(
            { length: 12 },
            (_, index) => `Row ${index}: ${'readable-result-'.repeat(120)}`
          ).join('\n'),
      };
      const wideTable =
        `| ${Array.from(
          { length: 7 },
          (_, index) => `Column ${index} ${'W'.repeat(36)}`
        ).join(' | ')} |\n` +
        `| ${Array(7).fill('---').join(' | ')} |\n` +
        `| ${Array.from(
          { length: 7 },
          (_, index) => `Long record ${index} ${'readable_content_'.repeat(4)}`
        ).join(' | ')} |`;
      const formattedHuman =
        'Formatted **user text** with `inline code`.\n\n```ts\nconst userValue = 7;\n```\n\n##### Small user heading\n\n###### Smallest user heading\n\n> A muted user quote.\n\n- [x] Reviewed user task\n- [ ] Pending user task\n\n' +
        wideTable;
      const history = (threadId: string, rows: readonly unknown[]) => [
        {
          values: { messages: rows },
          next: [],
          tasks: [],
          checkpoint: {
            thread_id: threadId,
            checkpoint_ns: '',
            checkpoint_id: 'saved',
          },
          parent_checkpoint: null,
          metadata: { source: 'input', step: 0, parents: {} },
          created_at: '2026-09-30T00:00:00.000Z',
        },
      ];
      const backend = await startProofServer([
        {
          method: 'POST',
          path: '/api/threads/search',
          payload: { limit: 50, offset: 0 },
          body: [thread, toolThread],
        },
        { method: 'GET', path: '/api/threads/visual', body: thread },
        {
          method: 'POST',
          path: '/api/threads/visual/history',
          payload: { limit: 10 },
          body: history('visual', messages),
        },
        { method: 'GET', path: '/api/threads/tool-output', body: toolThread },
        {
          method: 'POST',
          path: '/api/threads/tool-output/history',
          payload: { limit: 10 },
          body: history('tool-output', [
            {
              id: 'formatted-question',
              type: 'human',
              content: formattedHuman,
            },
            messages[1],
            toolMessage,
          ]),
        },
      ]);
      const server = await startCheckedServer({
        retained: retainedConsumer,
        target: backend.origin + '/api',
      });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      try {
        await page.setViewportSize({
          width,
          height: width === 375 ? 812 : 900,
        });
        await page.emulateMedia({
          colorScheme: theme,
          reducedMotion: 'reduce',
        });
        await page.route('**/*', (route) => {
          if (new URL(route.request().url()).origin === server.url)
            return route.continue();
          errors.push(`Unexpected external request: ${route.request().url()}`);
          return route.abort();
        });
        await page.goto(server.url);
        await page
          .getByRole('button', { name: 'Visual review', exact: true })
          .click();
        const assistant = page.locator('article.message-assistant');
        await expect(
          assistant.getByRole('heading', { name: 'Visual review', exact: true })
        ).toBeVisible();
        const input = page.getByRole('textbox', {
          name: 'Message',
          exact: true,
        });
        const transcript = page.getByRole('region', {
          name: 'Conversation messages',
          exact: true,
        });
        await transcript.evaluate((element) => {
          element.scrollTop = 0;
        });
        await expect(input).toHaveValue('');
        await expect(input).not.toBeFocused();
        await expect(page.locator('.message-tool')).toHaveCount(0);
        const metrics = await page.evaluate(() => {
          const pick = (selector: string) => {
            const element = document.querySelector(selector);
            if (!element)
              throw new Error(`Missing visual fixture element: ${selector}`);
            return element;
          };
          const style = (selector: string) => {
            const e = pick(selector),
              s = getComputedStyle(e),
              r = e.getBoundingClientRect();
            return {
              fontSize: s.fontSize,
              lineHeight: s.lineHeight,
              padding: s.padding,
              margin: s.margin,
              borderWidth: s.borderWidth,
              radius: s.borderRadius,
              width: r.width,
              height: r.height,
              x: r.x,
            };
          };
          const task = pick(
            'article.message-assistant li:has(input[type="checkbox"])'
          );
          const checkbox = task.querySelector('input'),
            paragraph = task.querySelector('p');
          if (!checkbox || !paragraph)
            throw new Error('Missing task checkbox or paragraph');
          const c = (
            task.querySelector('.tp-markdown__task-box') ?? checkbox
          ).getBoundingClientRect();
          const p = paragraph.getBoundingClientRect();
          const headingTop = pick(
            'article.message-assistant h1'
          ).getBoundingClientRect().top;
          const blockOffsets = [
            'h1',
            'p',
            'h2',
            'ul',
            'ul:has(input[type="checkbox"])',
            'table',
            'pre',
            'blockquote',
          ].map(
            (selector) =>
              pick(
                'article.message-assistant ' + selector
              ).getBoundingClientRect().top - headingTop
          );
          return {
            textarea: style('textarea'),
            placeholderColor: getComputedStyle(
              pick('textarea'),
              '::placeholder'
            ).color,
            placeholderOpacity: getComputedStyle(
              pick('textarea'),
              '::placeholder'
            ).opacity,
            hintColor: getComputedStyle(
              pick('.composer-help, .tp-chat-input__hint')
            ).color,
            heading: style('article.message-assistant h1'),
            pill: style(
              document.querySelector('.composer-pill')
                ? '.composer-pill'
                : '.tp-chat-input__pill'
            ),
            send: style('.composer button[type="submit"]'),
            paragraph: style('article.message-assistant p'),
            user: style('article.message-user'),
            pre: style('article.message-assistant pre'),
            cell: style('article.message-assistant td'),
            tableToCodeGap:
              pick('article.message-assistant pre').getBoundingClientRect()
                .top -
              pick('article.message-assistant table').getBoundingClientRect()
                .bottom,
            taskAligned:
              Math.abs(c.top + c.height / 2 - (p.top + p.height / 2)) < 8,
            taskBoxOffset: c.top - task.getBoundingClientRect().top,
            blockOffsets,
            primaryCapture: {
              draft: (pick('textarea') as HTMLTextAreaElement).value,
              inputFocused: document.activeElement === pick('textarea'),
              transcriptScrollTop: pick('.transcript').scrollTop,
              messageCount: document.querySelectorAll('article.message').length,
            },
            overflowX: document.documentElement.scrollWidth - innerWidth,
          };
        });
        const metricsPath = testInfo.outputPath(
          `${framework}-${width}-${theme}.json`
        );
        writeFileSync(
          metricsPath,
          JSON.stringify(
            {
              framework,
              width,
              height: width === 375 ? 812 : 900,
              theme,
              answerFixtureSha256: createHash('sha256')
                .update(answer)
                .digest('hex'),
              comparisonReactStylesSha256: createHash('sha256')
                .update(
                  readFileSync(
                    resolve(
                      __dirname,
                      '../../../../libs/react/src/chat/styles.css'
                    )
                  )
                )
                .digest('hex'),
              sourceFingerprintVerified: true,
              ...metrics,
            },
            null,
            2
          ) + '\n'
        );
        await testInfo.attach('visual-metrics', {
          path: metricsPath,
          contentType: 'application/json',
        });
        await page.screenshot({
          path: testInfo.outputPath(`${framework}-${width}-${theme}.png`),
        });
        expect.soft(metrics.textarea).toMatchObject({
          fontSize: '16px',
          lineHeight: '24px',
          padding: '0px',
          height: 24,
        });
        expect.soft(metrics.placeholderColor).toBe(metrics.hintColor);
        expect.soft(metrics.placeholderOpacity).toBe('1');
        expect.soft(metrics.pill).toMatchObject({
          padding: '8px 8px 8px 16px',
          height: 56,
          radius: '9999px',
          width: width === 375 ? 343 : 768,
        });
        if (width === 375) expect.soft(metrics.pill.x).toBe(16);
        expect.soft(metrics.send).toMatchObject({ width: 36, height: 36 });
        expect
          .soft(metrics.heading)
          .toMatchObject({ fontSize: '24px', lineHeight: '30px' });
        expect.soft(metrics.paragraph).toMatchObject({
          fontSize: '16px',
          lineHeight: '25.6px',
          padding: '0px',
          margin: '0px',
          borderWidth: '0px',
          width: width === 1280 ? 704 : 311,
        });
        expect.soft(metrics.user).toMatchObject({
          fontSize: '16px',
          lineHeight: '24px',
          padding: '8px 12px',
          radius: '15px',
        });
        expect.soft(metrics.pre).toMatchObject({
          fontSize: '14px',
          lineHeight: '21px',
          padding: '12px 16px',
          radius: '8px',
        });
        expect.soft(metrics.cell.padding).toBe('6px 10px');
        expect.soft(metrics.tableToCodeGap).toBe(12);
        expect.soft(metrics.taskAligned).toBe(true);
        expect.soft(metrics.taskBoxOffset).toBe(8);
        if (width === 1280) {
          const paragraphLineHeight = Number.parseFloat(
            metrics.paragraph.lineHeight
          );
          const paragraphLines = Math.round(
            metrics.paragraph.height / paragraphLineHeight
          );
          expect.soft(paragraphLines).toBeGreaterThan(0);
          expect
            .soft(
              Math.abs(
                metrics.paragraph.height - paragraphLines * paragraphLineHeight
              )
            )
            .toBeLessThan(1);
          // The system font can wrap the same 704px paragraph on Linux while
          // macOS fits one line. Preserve every canonical gap, accounting only
          // for complete additional text lines before the subsequent blocks.
          const wrappedParagraphHeight =
            metrics.paragraph.height - paragraphLineHeight;
          const canonicalOffsets = [
            0, 42, 67.59, 104.59, 171.78, 238.97, 358.14, 415.14,
          ];
          for (const [index, oneLineOffset] of canonicalOffsets.entries()) {
            const expected =
              oneLineOffset + (index >= 2 ? wrappedParagraphHeight : 0);
            expect
              .soft(
                Math.abs(metrics.blockOffsets[index] - expected),
                `canonical Markdown block ${index}`
              )
              .toBeLessThan(1);
          }
        }
        expect.soft(metrics.overflowX).toBe(0);
        await expectUnobstructed(input);
        await input.click();
        await page.keyboard.type('A draft after reading');
        await expect(input).toHaveValue('A draft after reading');
        await expect(input).toBeFocused();
        await input.fill('First line');
        await input.press('Enter');
        await page.keyboard.type('Second line');
        await expect(input).toHaveValue('First line\nSecond line');
        await expect
          .poll(() =>
            input.evaluate((element) => element.getBoundingClientRect().height)
          )
          .toBe(48);
        await input.fill('A line\n'.repeat(30));
        const maximumDraftHeight = await page.evaluate(
          (selected) =>
            selected === 'react'
              ? Math.min(320, (visualViewport?.height ?? innerHeight) * 0.2)
              : 320,
          framework
        );
        await expect
          .poll(() =>
            input.evaluate((element) => element.getBoundingClientRect().height)
          )
          .toBeCloseTo(maximumDraftHeight, 1);
        await expect
          .poll(() =>
            input.evaluate(
              (element) => element.scrollHeight > element.clientHeight
            )
          )
          .toBe(true);
        await input.fill('');
        await expect
          .poll(() =>
            input.evaluate((element) => element.getBoundingClientRect().height)
          )
          .toBe(24);
        // The matching PNG above contains only the common user/assistant fixture.
        // A separate controlled selection owns the long tool-output probes.
        await input.fill('This draft belongs to Visual review.');
        await page
          .getByRole('button', { name: 'Tool output check', exact: true })
          .click();
        await expect(page.locator('#conversation-title')).toHaveText(
          'Tool output check'
        );
        await expect(page.locator('.message-tool > pre')).toBeAttached();
        await expect(input).toHaveValue('');
        await expect
          .poll(() =>
            input.evaluate((element) => element.getBoundingClientRect().height)
          )
          .toBe(24);
        const formattedUser = page.locator('article.message-user');
        const formattedEvidence = await formattedUser.evaluate((user) => {
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = 1;
          const context = canvas.getContext('2d');
          if (!context) throw new Error('Expected canvas color normalization');
          const rgb = (color: string) => {
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = color;
            context.fillRect(0, 0, 1, 1);
            return Array.from(context.getImageData(0, 0, 1, 1).data).slice(
              0,
              3
            );
          };
          const luminance = (color: number[]) =>
            color
              .map((value) => {
                const channel = value / 255;
                return channel <= 0.04045
                  ? channel / 12.92
                  : ((channel + 0.055) / 1.055) ** 2.4;
              })
              .reduce(
                (sum, value, index) =>
                  sum + value * [0.2126, 0.7152, 0.0722][index],
                0
              );
          const contrast = (text: string, background: string) => {
            const values = [
              luminance(rgb(text)),
              luminance(rgb(background)),
            ].sort((a, b) => b - a);
            return (values[0] + 0.05) / (values[1] + 0.05);
          };
          const background = getComputedStyle(user).backgroundColor;
          const selectors = [
            'p code',
            'pre',
            'th',
            'td',
            'blockquote',
            'h5',
            'h6',
          ];
          const palette = selectors.map((selector) => {
            const element = user.querySelector(selector);
            if (!element)
              throw new Error(`Missing formatted-user fixture: ${selector}`);
            const style = getComputedStyle(element);
            const ownBackground = rgb(style.backgroundColor);
            return {
              selector,
              color: style.color,
              background: style.backgroundColor,
              contrast: contrast(
                style.color,
                ['td', 'blockquote', 'h5', 'h6'].includes(selector)
                  ? background
                  : style.backgroundColor
              ),
              foregroundMatchesUser:
                rgb(style.color).join(',') ===
                rgb(getComputedStyle(user).color).join(','),
              ownBackground,
            };
          });
          const checked =
            user.querySelector('.tp-markdown__task-box[data-checked="true"]') ??
            user.querySelector('input[type="checkbox"]:checked');
          if (!checked) throw new Error('Missing checked user task');
          const checkedStyle = getComputedStyle(checked);
          const glyph =
            checked.tagName === 'INPUT'
              ? getComputedStyle(checked, '::after').borderRightColor
              : checkedStyle.color;
          return {
            palette,
            checkedTask: {
              fillMatchesUserText:
                rgb(checkedStyle.backgroundColor).join(',') ===
                rgb(getComputedStyle(user).color).join(','),
              glyphMatchesUserBackground:
                rgb(glyph).join(',') === rgb(background).join(','),
              contrast: contrast(glyph, checkedStyle.backgroundColor),
            },
          };
        });
        const palette = formattedEvidence.palette;
        for (const row of palette)
          expect
            .soft(row.contrast, `${row.selector} user contrast`)
            .toBeGreaterThanOrEqual(4.5);
        for (const row of palette.filter(
          (row) => !['blockquote', 'h5', 'h6'].includes(row.selector)
        ))
          expect.soft(row.foregroundMatchesUser).toBe(true);
        expect
          .soft(formattedEvidence.checkedTask.fillMatchesUserText)
          .toBe(true);
        expect
          .soft(formattedEvidence.checkedTask.glyphMatchesUserBackground)
          .toBe(true);
        expect
          .soft(formattedEvidence.checkedTask.contrast)
          .toBeGreaterThanOrEqual(4.5);
        const wideGroup = formattedUser.getByRole('group', {
          name: 'Table',
          exact: true,
        });
        await expect(wideGroup).toHaveAttribute('tabindex', '0');
        await wideGroup.scrollIntoViewIfNeeded();
        if (width === 375) {
          await expect
            .poll(() =>
              wideGroup.evaluate(
                (element) => element.scrollWidth > element.clientWidth
              )
            )
            .toBe(true);
          await wideGroup.focus();
          await expect(wideGroup).toBeFocused();
          await wideGroup.press('ArrowRight');
          await expect
            .poll(() => wideGroup.evaluate((element) => element.scrollLeft))
            .toBeGreaterThan(0);
        }
        writeFileSync(
          testInfo.outputPath(`${framework}-${width}-${theme}-secondary.json`),
          JSON.stringify(
            {
              formattedUserPalette: palette,
              checkedTask: formattedEvidence.checkedTask,
              table: await wideGroup.evaluate((element) => ({
                clientWidth: element.clientWidth,
                scrollWidth: element.scrollWidth,
                scrollLeft: element.scrollLeft,
              })),
            },
            null,
            2
          ) + '\n'
        );
        await transcript.evaluate((element) => {
          element.scrollTop = 0;
        });
        if (width === 375) {
          await expect
            .poll(() =>
              transcript.evaluate(
                (element) => element.scrollHeight > element.clientHeight
              )
            )
            .toBe(true);
          await transcript.hover();
          await page.mouse.wheel(0, 200);
          await expect
            .poll(() => transcript.evaluate((element) => element.scrollTop))
            .toBeGreaterThan(0);
        }
        await transcript.evaluate((element) => {
          element.scrollTop = 0;
        });
        await transcript.focus();
        await expect(transcript).toBeFocused();
        await transcript.press('PageDown');
        await expect
          .poll(() => transcript.evaluate((element) => element.scrollTop))
          .toBeGreaterThan(0);
        const toolOutput = page.locator('.message-tool > pre');
        await toolOutput.scrollIntoViewIfNeeded();
        await expect(toolOutput).toContainText('Long tool output:');
        await expect
          .poll(() =>
            toolOutput.evaluate(
              (element) => element.scrollWidth > element.clientWidth
            )
          )
          .toBe(true);
        await toolOutput.evaluate((element) => {
          element.scrollLeft = 200;
        });
        await expect
          .poll(() => toolOutput.evaluate((element) => element.scrollLeft))
          .toBeGreaterThan(0);
        await page
          .getByRole('searchbox', {
            name: 'Filter loaded conversations by title',
          })
          .scrollIntoViewIfNeeded();
        await expectUnobstructed(input);
        backend.verify();
        expect(errors).toEqual([]);
      } finally {
        await page.close();
        await server.close();
        await backend.close();
      }
    });
  }
