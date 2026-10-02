import { test, expect, type Page } from '@playwright/test';
test.beforeEach(async ({ request }) => {
  await request.post('/__reset');
});
const conversation = (page: Page) =>
  page.getByRole('region', { name: 'Conversation', exact: true });
async function send(page: Page, text: string) {
  await page.getByLabel('Message', { exact: true }).fill(text);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
}
for (const mode of [
  'HTTP error',
  'Run error',
  'Legacy',
  'Multiple',
  'Expired',
  'Malformed',
  'Negative amount',
  'Child',
  'Child interrupt',
  'Tool',
  'Duplicate identity',
  'Wrong terminal',
  'Notice EOF',
]) {
  test(`${mode} blocks native approval without replay`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/interrupts/react/');
    await send(page, mode);
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    await expect(page.locator('body')).not.toContainText('PRIVATE');
    const before = await (await request.get('/__requests')).json();
    expect(before).toHaveLength(1);
    await page.waitForTimeout(100);
    expect(await (await request.get('/__requests')).json()).toEqual(before);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await send(page, 'Fresh refund');
    await expect(page.getByRole('status')).toHaveText(
      'Awaiting your decision.'
    );
    const after: Wire[] = await (await request.get('/__requests')).json();
    expect(after[1].body.threadId).not.toBe(before[0].body.threadId);
    expect(after[1].body.messages).toHaveLength(1);
  });
}
for (const mode of [
  'Resume error',
  'Resume interrupted',
  'Resume wrong terminal',
  'Resume truncated prefix',
  'Resume old state',
  'Resume duplicate identity',
  'Resume second pause',
]) {
  test(`${mode} requires New after exactly one native response`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/interrupts/react/');
    await send(page, mode);
    await expect(page.getByRole('status')).toHaveText(
      'Awaiting your decision.'
    );
    await page.getByRole('button', { name: 'Approve', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Start a new conversation to continue.'
    );
    await expect(
      page.getByRole('button', { name: 'Approve', exact: true })
    ).toHaveCount(0);
    const before: Wire[] = await (await request.get('/__requests')).json();
    expect(before).toHaveLength(2);
    expect(before[1].body.resume).toHaveLength(1);
    await page.waitForTimeout(100);
    expect(await (await request.get('/__requests')).json()).toEqual(before);
    await expect(page.locator('body')).not.toContainText('PRIVATE');
  });
}
for (const phase of ['draft', 'resume'])
  for (const exit of ['Stop', 'pagehide']) {
    test(`${exit} closes a held ${phase} socket and fences late completion`, async ({
      page,
      request,
    }) => {
      await page.goto('/ag-ui/interrupts/react/');
      await send(page, phase === 'draft' ? 'Hold' : 'Resume hold');
      if (phase === 'resume') {
        await expect(page.getByRole('status')).toHaveText(
          'Awaiting your decision.'
        );
        await page
          .getByRole('button', { name: 'Approve', exact: true })
          .click();
      }
      await expect(conversation(page)).toContainText('Live partial');
      expect((await (await request.get('/__lifetime')).json()).active).toBe(
        true
      );
      if (exit === 'Stop') {
        await page.getByRole('button', { name: 'Stop', exact: true }).click();
        await expect(page.getByRole('status')).toHaveText(
          'Start a new conversation to continue.'
        );
      } else {
        await page.evaluate(() =>
          window.dispatchEvent(new PageTransitionEvent('pagehide'))
        );
        await expect(conversation(page)).toHaveCount(0);
      }
      await expect
        .poll(
          async () => (await (await request.get('/__lifetime')).json()).active
        )
        .toBe(false);
      await request.post('/__release');
      expect(await (await request.get('/__requests')).json()).toHaveLength(
        phase === 'draft' ? 1 : 2
      );
    });
  }
test('an incremental draft settles to the current pause and a held resume permits one decision only', async ({
  page,
  request,
}) => {
  await page.goto('/ag-ui/interrupts/react/');
  await send(page, 'Hold');
  await expect(conversation(page)).toContainText('Live partial');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toHaveCount(0);
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText('Awaiting your decision.');
  await expect(conversation(page)).not.toContainText('Live partial');
  await page.getByRole('button', { name: 'New conversation' }).click();
  await send(page, 'Resume hold');
  await expect(page.getByRole('status')).toHaveText('Awaiting your decision.');
  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  await expect(conversation(page)).toContainText('Live partial');
  await expect(
    page.getByRole('button', { name: 'Approve', exact: true })
  ).toBeDisabled();
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find(
      (button) => button.textContent === 'Approve'
    );
    button?.click();
  });
  expect(await (await request.get('/__requests')).json()).toHaveLength(3);
  await request.post('/__release');
  await expect(page.getByRole('status')).toHaveText(
    'Refund decision complete.'
  );
  await expect(conversation(page).locator('li')).toHaveCount(3);
});
type Wire = {
  path: string;
  method: string;
  body: {
    threadId: string;
    runId: string;
    protocolVersion: string;
    messages: { id: string; role: string; content: string }[];
    resume?: { interruptId: string; status: string; payload: unknown }[];
    tools: unknown[];
    context: unknown[];
    forwardedProps: unknown;
  };
};
test('native approval text and three actions fit a narrow viewport literally', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/ag-ui/interrupts/react/');
  const text = '<img src=x onerror=alert(1)> **literal**';
  await send(page, text);
  await expect(page.getByRole('status')).toHaveText('Awaiting your decision.');
  await expect(conversation(page)).toContainText(text);
  expect(await conversation(page).locator('img').count()).toBe(0);
  expect(
    await page
      .locator('body')
      .evaluate((element) => element.scrollWidth <= window.innerWidth)
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('ag-ui-interrupts-mobile.png'),
    fullPage: true,
  });
});
test('the authored developer endpoint handles submit and resume without appearing in the UI', async ({
  page,
  request,
}) => {
  await page.goto('http://127.0.0.1:3000/');
  await page.setContent(`<!doctype html><html><body><p id="state">Waiting</p><script>
    addEventListener('message', event => {
      const frame = document.getElementById('pilot');
      if (event.origin !== 'http://127.0.0.1:4610' || event.source !== frame.contentWindow) return;
      if (event.data.type === 'tplane:runtime-child-ready') frame.contentWindow.postMessage({
        type: 'tplane:runtime-configure', version: 2, nonce: event.data.nonce, generation: 1,
        target: { kind: 'ag-ui', endpoint: 'http://127.0.0.1:4610/developer-agent' }
      }, event.origin);
      if (event.data.type === 'tplane:runtime-configured') frame.contentWindow.postMessage({
        type: 'tplane:runtime-check', version: 1, nonce: 'parent-health', capability: 'interrupts'
      }, event.origin);
      if (event.data.type === 'tplane:runtime-ready' && event.data.nonce === 'parent-health') document.getElementById('state').textContent = 'Ready';
    });</script><iframe id="pilot" title="React preview" src="http://127.0.0.1:4610/ag-ui/interrupts/react/"></iframe></body></html>`);
  await expect(page.locator('#state')).toHaveText('Ready');
  const frame = page.frameLocator('#pilot');
  await expect(
    frame.getByRole('region', { name: 'Runtime connection' })
  ).toContainText('Developer runtime');
  await frame
    .getByLabel('Message', { exact: true })
    .fill('Fictional developer refund');
  await frame.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(frame.getByRole('status')).toHaveText('Awaiting your decision.');
  await frame
    .getByRole('button', { name: 'Cancel refund', exact: true })
    .click();
  await expect(frame.getByRole('status')).toHaveText(
    'Refund decision complete.'
  );
  const wire: Wire[] = await (await request.get('/__requests')).json();
  expect(wire).toHaveLength(2);
  expect(
    wire.every(
      (entry) => entry.path === '/developer-agent' && entry.method === 'POST'
    )
  ).toBe(true);
  expect(wire[0].body.threadId).toBe(wire[1].body.threadId);
  await expect(frame.locator('body')).not.toContainText('/developer-agent');
});
for (const action of ['Approve', 'Edit and approve', 'Cancel refund']) {
  test(`installed SDK executes an exact native ${action} and keeps the confirmed conversation`, async ({
    page,
    request,
  }) => {
    await page.goto('/ag-ui/interrupts/react/');
    expect(await (await request.get('/__requests')).json()).toEqual([]);
    await send(page, '  Fictional refund  ');
    await expect(page.getByRole('status')).toHaveText(
      'Awaiting your decision.'
    );
    await expect(conversation(page).locator('li')).toHaveCount(2);
    await expect(page.getByLabel('Message', { exact: true })).toBeDisabled();
    if (action === 'Edit and approve')
      await page
        .getByRole('spinbutton', { name: 'Edited amount (USD)' })
        .fill('20');
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('status')).toHaveText(
      'Refund decision complete.'
    );
    await expect(conversation(page).locator('li')).toHaveCount(3);
    await expect(conversation(page)).toContainText(
      action === 'Cancel refund'
        ? 'Refund cancelled'
        : action === 'Edit and approve'
        ? '$20.00'
        : '$25.00'
    );
    const before: Wire[] = await (await request.get('/__requests')).json();
    expect(before).toHaveLength(2);
    for (const entry of before) {
      expect(entry.path).toBe('/ag-ui/interrupts/agent/native');
      expect(entry.method).toBe('POST');
      expect(entry.body.protocolVersion).toBe('1.0');
      expect(entry.body.tools).toEqual([]);
      expect(entry.body.context).toEqual([]);
      expect(entry.body.forwardedProps).toEqual({});
    }
    expect(before[0].body.messages.map((message) => message.content)).toEqual([
      '  Fictional refund  ',
    ]);
    expect(before[1].body.messages.map((message) => message.content)).toEqual([
      '  Fictional refund  ',
      'Draft ready.',
    ]);
    expect(before[1].body.resume).toEqual([
      {
        interruptId: 'interrupt-1',
        status: 'resolved',
        payload:
          action === 'Cancel refund'
            ? { approved: false }
            : action === 'Edit and approve'
            ? { approved: true, amount: 20 }
            : { approved: true },
      },
    ]);
    expect(before[0].body.threadId).toBe(before[1].body.threadId);
    expect(before[0].body.runId).not.toBe(before[1].body.runId);
    await send(page, 'Second refund');
    await expect(page.getByRole('status')).toHaveText(
      'Awaiting your decision.'
    );
    await expect(conversation(page).locator('li')).toHaveCount(5);
    const continued: Wire[] = await (await request.get('/__requests')).json();
    expect(continued[2].body.threadId).toBe(before[0].body.threadId);
    expect(continued[2].body.messages).toHaveLength(4);
    expect(
      new Set(continued[2].body.messages.map((message) => message.id)).size
    ).toBe(4);
    await page.getByRole('button', { name: 'New conversation' }).click();
    await expect(conversation(page).locator('li')).toHaveCount(0);
    await expect(
      page.getByRole('heading', { name: 'Refund approval' })
    ).toHaveCount(0);
    expect(await (await request.get('/__requests')).json()).toEqual(continued);
    await send(page, 'Fresh refund');
    await expect(page.getByRole('status')).toHaveText(
      'Awaiting your decision.'
    );
    const fresh: Wire[] = await (await request.get('/__requests')).json();
    expect(fresh[3].body.threadId).not.toBe(before[0].body.threadId);
    expect(fresh[3].body.messages).toHaveLength(1);
    expect(new Set(fresh.map((entry) => entry.body.runId)).size).toBe(4);
  });
}
