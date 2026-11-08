import { test, expect, type Page, type FrameLocator } from '@playwright/test';
import { selectFramework } from './fixtures/framework-controls';

test.describe.configure({ mode: 'serial' });
test.skip(
  Boolean(process.env['BASE_URL']),
  'Uses local deterministic HTTP/SSE fixtures, not live model inference.'
);

async function openWorkbench(page: Page, framework: 'angular' | 'react') {
  await page.goto(`/docs/${framework}/getting-started/workbench`);
  // The persistent workspace replaces the server-rendered article when it
  // registers. A click on that earlier copy can be discarded with its state.
  // Use the same readiness contract as the other docs control-plane tests.
  const workspace = page.locator('[data-workspace-shell]');
  await expect(workspace).toHaveAttribute('data-hydrated', 'true');
  return workspace.locator('.tp-learn-host');
}

async function customTarget(page: Page, caseId: string) {
  await page
    .locator('.tp-learn-host')
    .getByText('Runtime settings', { exact: true })
    .click();
  const settings = page.locator(
    '.tp-learn-host [data-runtime-target-settings]'
  );
  await settings.getByRole('radio', { name: 'Custom LangSmith' }).check();
  await settings
    .locator('input[name="rtu"]')
    .fill(`http://127.0.0.1:4399/case/${caseId}/langgraph/delayed`);
  await settings.locator('input[name="rts"]').fill('test-key-redact-me');
  await settings.getByRole('button', { name: 'Use custom target' }).click();
  await expect(settings).toHaveAttribute(
    'data-runtime-target-kind',
    'langsmith'
  );
  await page
    .locator('.tp-learn-host')
    .getByText('Runtime settings', { exact: true })
    .click();
}
async function submit(frame: FrameLocator, framework: string, message: string) {
  await frame
    .getByRole('textbox', {
      name: framework === 'react' ? 'Message' : 'Type a message',
      exact: true,
    })
    .fill(message);
  // Fixed-position example shells cannot scroll their own document. Reveal
  // the containing iframe before Playwright clicks a control inside it.
  await frame.owner().scrollIntoViewIfNeeded();
  await frame
    .getByRole('button', {
      name: framework === 'react' ? 'Send' : 'Send message',
      exact: true,
    })
    .click();
}

test('Angular navigation resize persists and expanded workbench uses the full workspace width', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const host = await openWorkbench(page, 'angular');
  const shell = page.locator('[data-workspace-shell]');
  const navigation = page.locator('[data-workspace-desktop-navigation]');
  const resize = page.getByRole('separator', {
    name: 'Resize navigation',
    exact: true,
  });
  const surface = page.locator('[data-workspace-surface]');
  const navigationWidth = () =>
    navigation.evaluate((element) => element.getBoundingClientRect().width);
  await expect(resize).toHaveAttribute('aria-valuenow', '264');
  await expect.poll(navigationWidth).toBe(264);
  await resize.focus();
  await page.keyboard.press('ArrowRight');
  await expect(resize).toHaveAttribute('aria-valuenow', '274');
  await expect.poll(navigationWidth).toBe(274);
  await page.reload();
  await expect(resize).toHaveAttribute('aria-valuenow', '274');
  await expect.poll(navigationWidth).toBe(274);

  await host
    .getByRole('button', { name: 'Expand workbench', exact: true })
    .click();
  await expect(host).toHaveAttribute('data-expanded', 'true');
  await expect(navigation).toBeHidden();
  await expect
    .poll(async () => {
      const frame = await shell.boundingBox();
      const content = await surface.boundingBox();
      return frame && content
        ? { left: content.x - frame.x, width: content.width - frame.width }
        : null;
    })
    .toEqual({ left: 0, width: 0 });
  const canvas = await host.evaluate((element) => {
    const article = element.closest('article')!;
    const style = getComputedStyle(article);
    return {
      actual: element.getBoundingClientRect().width,
      available:
        article.clientWidth -
        parseFloat(style.paddingLeft) -
        parseFloat(style.paddingRight),
    };
  });
  expect(canvas.actual).toBeCloseTo(canvas.available, 1);
  await host
    .getByRole('button', { name: 'Restore workbench width', exact: true })
    .click();
  await expect(navigation).toBeVisible();
  await expect.poll(navigationWidth).toBe(274);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(resize).toBeHidden();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    )
  ).toBe(true);
});

for (const framework of ['react', 'angular'] as const) {
  test(`${framework}: source inspection preserves the recorded session and supports keyboard return on narrow layouts`, async ({
    page,
    browserName,
  }) => {
    const host = await openWorkbench(page, framework);
    const sessions = host.getByRole('group', { name: 'Example session' });
    await expect(sessions.getByRole('button')).toHaveCount(1);
    const live = sessions.getByRole('button', { name: 'Live conversation' });
    await expect(live).toHaveAttribute('aria-pressed', 'false');
    const source = host.getByRole('button', {
      name: 'View example source',
      exact: true,
    });
    await host.getByRole('button', { name: 'Inspect data', exact: true }).click();
    await host.getByRole('button', { name: 'Next observation' }).click();
    const cursor = await host
      .getByRole('slider', { name: 'Observation' })
      .inputValue();
    await source.focus();
    await page.keyboard.press('Enter');
    await expect(source).toHaveAttribute('aria-expanded', 'true');
    await expect(live).toHaveAttribute('aria-pressed', 'false');
    const region = host.getByRole('region', {
      name: 'Example source',
      exact: true,
    });
    await expect(region).toHaveAttribute(
      'id',
      (await source.getAttribute('aria-controls'))!
    );
    await expect(region).toBeFocused();
    // macOS WebKit's default keyboard preference reaches buttons with Option+Tab.
    await page.keyboard.press(
      browserName === 'webkit' && process.platform === 'darwin'
        ? 'Alt+Tab'
        : 'Tab'
    );
    const back = host.getByRole('button', {
      name: 'Return to recorded example',
    });
    await expect(back).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(source).toBeFocused();
    await expect(source).toHaveAttribute('aria-expanded', 'false');
    await expect(host.getByRole('slider', { name: 'Observation' })).toHaveValue(
      cursor
    );
    await expect(host.locator('iframe')).toHaveCount(0);
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await source.click();
      for (const control of [
        live,
        source,
        back,
      ]) {
        const box = await control.boundingBox();
        expect(box?.height).toBeGreaterThanOrEqual(44);
        expect(box?.width).toBeGreaterThanOrEqual(44);
      }
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await back.click();
      await expect(
        host.getByRole('slider', { name: 'Observation' })
      ).toHaveValue(cursor);
    }
  });

  test(`${framework}: real app submit, historical inspection, return to live and new conversation`, async ({
    page,
    request,
  }, testInfo) => {
    test.setTimeout(120_000);
    const errors: string[] = [];
    const submittedRuns: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (request.method() === 'POST' && path.endsWith('/runs/stream'))
        submittedRuns.push(path);
    });
    if (framework === 'react')
      await request.post('http://127.0.0.1:4600/__reset');
    const caseId = `learning-${framework}-${testInfo.retry}`;
    await request.delete(`http://127.0.0.1:4399/__requests/${caseId}`);
    const host = await openWorkbench(page, framework);
    await expect(
      host.getByRole('button', { name: 'Live conversation', exact: true })
    ).toBeVisible({ timeout: 30_000 });
    await expect(host.locator('iframe')).toHaveCount(0);
    await host
      .getByRole('button', { name: 'Live conversation', exact: true })
      .click();
    await expect(
      host.getByRole('button', { name: 'Live conversation', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    if (framework === 'angular') await customTarget(page, caseId);
    const frame = host.frameLocator('iframe');
    await submit(frame, framework, 'First');
    await host.getByRole('button', { name: 'Requests', exact: true }).click();
    await expect(
      host.getByText('Application call pending', { exact: true })
    ).toBeVisible();
    await expect(
      host.getByRole('button', { name: 'Recorded example', exact: true })
    ).toBeDisabled();
    const iframe = await host.locator('iframe').elementHandle();
    await host
      .getByRole('button', { name: 'View example source', exact: true })
      .click();
    await expect(
      host.getByRole('button', { name: 'Live conversation', exact: true })
    ).toHaveAttribute('aria-pressed', 'true');
    await expect(host.getByLabel('Lesson source code')).toBeVisible();
    expect(await iframe?.evaluate((element) => element.isConnected)).toBe(true);
    const returnToSession = host.getByRole('button', {
      name: 'Return to live conversation',
    });
    await expect(returnToSession).toBeEnabled();
    await returnToSession.click();
    await expect(
      host.getByRole('button', { name: 'View example source', exact: true })
    ).toBeFocused();
    expect(await iframe?.evaluate((element) => element.isConnected)).toBe(true);
    if (framework === 'react')
      await expect(
        frame.getByRole('region', { name: 'Conversation' })
      ).toContainText('Live partial');
    await host.getByRole('slider', { name: 'Observation' }).focus();
    await page.keyboard.press('Home');
    await expect(host.locator('iframe')).toBeHidden();
    await expect(
      host.getByText('No calls observed at this point.')
    ).toBeVisible();
    if (framework === 'react')
      await request.post('http://127.0.0.1:4600/__release');
    await expect(
      host.getByRole('button', { name: 'Recorded example', exact: true })
    ).toBeEnabled({ timeout: 15_000 });
    // Incoming observations do not move a historical playhead.
    await expect(host.getByRole('slider', { name: 'Observation' })).toHaveValue(
      '0'
    );
    await host.getByRole('button', { name: 'Return to live' }).click();
    await expect
      .poll(() => iframe?.evaluate((element) => element.isConnected))
      .toBe(true);
    await expect(
      host.getByText('Application call settled', { exact: true })
    ).toBeVisible();
    await expect(host.locator('iframe')).toBeVisible();
    await frame.owner().scrollIntoViewIfNeeded();
    await frame
      .getByRole('button', { name: 'New conversation', exact: true })
      .click();
    await expect(
      host.getByText('No calls observed at this point.')
    ).toBeVisible();
    await submit(frame, framework, 'Second');
    await expect(
      host.getByText('Application call settled', { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    const requests =
      framework === 'react'
        ? await (await request.get('http://127.0.0.1:4600/__requests')).json()
        : await (
            await request.get(`http://127.0.0.1:4399/__requests/${caseId}`)
          ).json();
    if (framework === 'react')
      expect(
        requests.filter((item: { path: string }) =>
          item.path.endsWith('/runs/stream')
        )
      ).toHaveLength(2);
    else
      expect(
        requests.some((item: { keyMatched: boolean }) => item.keyMatched)
      ).toBe(true);
    expect(submittedRuns).toHaveLength(2);
    expect(await host.textContent()).not.toContain('test-key-redact-me');
    await page.setViewportSize({ width: 1440, height: 1200 });
    await host.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath(`${framework}-live-inspection.png`),
    });
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth
      )
    ).toBe(true);
    expect(errors).toEqual([]);
  });
}

for (const framework of ['react', 'angular'] as const) {
  test(`${framework}: source, resizable panels, layout persistence and cockpit access`, async ({
    page,
  }) => {
    const host = await openWorkbench(page, framework);
    await host
      .getByRole('button', { name: 'View example source', exact: true })
      .click();
    await expect(host.locator('iframe')).toHaveCount(0);
    const highlight = host.locator('[data-highlighted]').first();
    const geometry = await highlight.evaluate((element) => {
      const pre = element.closest('pre')!;
      const line = element.getBoundingClientRect();
      const panel = pre.getBoundingClientRect();
      return { line: line.top, top: panel.top, bottom: panel.bottom };
    });
    expect(geometry.line).toBeGreaterThanOrEqual(geometry.top);
    expect(geometry.line).toBeLessThan(geometry.bottom);
    await expect(
      host.getByRole('link', { name: 'View file on GitHub' })
    ).toHaveAttribute('href', /\/blob\/[a-f0-9]{40}\//);
    const files = host.getByRole('separator', {
      name: 'Resize source file list',
    });
    await files.focus();
    await page.keyboard.press('ArrowRight');
    await expect(files).toHaveAttribute('aria-valuenow', '206');
    await host
      .getByRole('button', { name: 'Return to recorded example', exact: true })
      .click();
    await host
      .getByText('Connect observations to source', { exact: true })
      .click();
    await host.getByRole('button', { name: 'See it run', exact: true }).click();
    await host.getByRole('button', { name: 'Inspect data', exact: true }).click();
    await expect(
      host.getByRole('slider', { name: 'Observation' })
    ).not.toHaveValue('0');
    await expect(
      host.getByRole('button', { name: 'Play recording' })
    ).toBeVisible();
    const split = host.getByRole('separator', {
      name: 'Resize conversation and explanation',
    });
    await split.scrollIntoViewIfNeeded();
    const box = await split.boundingBox();
    if (!box) throw new Error('Expected a visible workbench separator');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, {
      steps: 8,
    });
    await page.mouse.up();
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeGreaterThan(
      44
    );
    const height = host.getByRole('separator', {
      name: 'Resize workbench height',
    });
    await height.focus();
    await page.keyboard.press('ArrowDown');
    await expect(height).toHaveAttribute('aria-valuenow', '420');
    const savedSplit = await split.getAttribute('aria-valuenow');
    await page.reload();
    await expect(split).toHaveAttribute('aria-valuenow', savedSplit!);
    await expect(height).toHaveAttribute('aria-valuenow', '420');
    await host.getByRole('button', { name: 'Expand workbench' }).click();
    await expect(host).toHaveAttribute('data-expanded', 'true');
    await host.getByRole('button', { name: 'Reset layout' }).click();
    await expect(split).toHaveAttribute('aria-valuenow', '44');
    await expect(height).toHaveAttribute('aria-valuenow', '400');
    await expect(
      host.getByRole('link', {
        name: `Open ${
          framework === 'react' ? 'React' : 'Angular'
        } streaming example`,
      })
    ).toHaveAttribute('href', `/docs/${framework}/langgraph/guides/streaming`);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const mode of ['View example source', 'Return to recorded example']) {
      await host.getByRole('button', { name: mode, exact: true }).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
    }
  });
}

test('React stop and failure remain distinct from application call settlement', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:4600/__reset');
  const host = await openWorkbench(page, 'react');
  await host
    .getByRole('button', { name: 'Live conversation', exact: true })
    .click();
  await expect(
    host.getByRole('button', { name: 'Live conversation', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  const frame = host.frameLocator('iframe');
  await submit(frame, 'react', 'First');
  await expect(
    frame.getByRole('region', { name: 'Conversation' })
  ).toContainText('Live partial');
  await frame.owner().scrollIntoViewIfNeeded();
  await frame.getByRole('button', { name: 'Stop', exact: true }).click();
  await host.getByRole('button', { name: 'JSON', exact: true }).click();
  await expect(host.getByLabel('Application state JSON')).toContainText(
    '"outcome": "aborted"'
  );
  await frame.owner().scrollIntoViewIfNeeded();
  await frame
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await submit(frame, 'react', 'Error');
  await expect(host.getByLabel('Application state JSON')).toContainText(
    '"hasFailure": true'
  );
  await expect(host.getByLabel('Application state JSON')).toContainText(
    '"outcome": "error"'
  );
  await host.getByRole('button', { name: 'Requests', exact: true }).click();
  await expect(
    host.getByText('Application call settled', { exact: true })
  ).toBeVisible();
  expect(await host.textContent()).not.toContain('PRIVATE response');
});

test('framework changes dispose an active React stream and restore opt-in replay', async ({
  page,
  request,
}) => {
  await request.post('http://127.0.0.1:4600/__reset');
  const host = await openWorkbench(page, 'react');
  await host
    .getByRole('button', { name: 'Live conversation', exact: true })
    .click();
  await expect(
    host.getByRole('button', { name: 'Live conversation', exact: true })
  ).toHaveAttribute('aria-pressed', 'true');
  await submit(host.frameLocator('iframe'), 'react', 'First');
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4600/__lifetime')).json()
        ).active
    )
    .toBe(true);
  await selectFramework(page, 'angular');
  await expect(host.locator('iframe')).toHaveCount(0);
  await expect
    .poll(
      async () =>
        (
          await (await request.get('http://127.0.0.1:4600/__lifetime')).json()
        ).active
    )
    .toBe(false);
});
