import { expect, type Page } from '@playwright/test';

/** Full viewport contract shared by both framework adapters, without CSS overrides. */
export async function expectMessagesShell(page: Page, width: number, height: number) {
  const angular = await page.locator('example-chat-layout').count() > 0;
  const header = page.locator(angular ? '.layout__header' : '.tp-example__conversation > header');
  const docs = page.locator(angular ? '.layout__sidebar' : '.tp-example__about');
  const footer = page.locator(angular ? '.input-strip' : '.tp-example__footer');
  const pill = page.locator(angular ? '.chat-input__pill' : '.tp-chat-input__pill');
  const mainWidth = width < 768 ? width : width - 288;
  await expect(header.getByRole('heading', { name: 'Chat messages', exact: true })).toBeVisible();
  await expect(header.getByRole('button', { name: 'New conversation', exact: true })).toBeVisible();
  await expect(page.locator('textarea')).toHaveAttribute('placeholder', 'Ask an aviation question…');
  await expect(header.locator('h1')).toHaveCSS('color', await page.locator('textarea').evaluate((element) => getComputedStyle(element).color));
  const h = await header.boundingBox(), d = await docs.boundingBox(), f = await footer.boundingBox(), p = await pill.boundingBox();
  expect(h).toMatchObject({ x: 0, y: 0, width: mainWidth, height: 53 });
  expect(d?.width).toBe(width < 768 ? width : 288);
  expect(d?.x).toBe(width < 768 ? 0 : mainWidth);
  expect(d?.y).toBeCloseTo(width < 768 ? height - (d?.height ?? 0) : 0, 1);
  expect(f?.height).toBeCloseTo(99, 1);
  expect(f?.y).toBeCloseTo((width < 768 ? d?.y ?? 0 : height) - 99, 1);
  expect(p?.x).toBe((mainWidth - Math.min(768, mainWidth - 32)) / 2);
  expect(p?.width).toBe(Math.min(768, mainWidth - 32));
  expect(p?.y).toBeCloseTo((f?.y ?? 0) + 9, 1);
  await expect(footer).toHaveCSS('border-top-width', '1px');
  await expect(footer.getByRole('status').last()).toHaveCSS('font-size', '12px');
  await expect(footer.getByRole('status').last()).toHaveCSS('line-height', '18px');
  await expect(docs.getByRole('heading', { name: 'About this example' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
}

/** Outer-shell parity for composed chat and the configurable input example. */
export async function expectExampleShell(page: Page, title: string, width: number, height: number, footerHeight = 99) {
  const angular = await page.locator('example-chat-layout').count() > 0;
  const header = page.locator(angular ? '.layout__header' : '.tp-example__conversation > header');
  const docs = page.locator(angular ? '.layout__sidebar' : '.tp-example__about');
  const footer = page.locator(angular ? '.input-strip, .chat-footer-wrap' : '.tp-example__footer');
  const pill = page.locator(angular ? '.chat-input__pill' : '.tp-chat-input__pill');
  const mainWidth = width < 768 ? width : width - 288;
  await expect(header.getByRole('heading', { name: title, exact: true })).toBeVisible();
  expect(await header.boundingBox()).toMatchObject({ x: 0, y: 0, width: mainWidth, height: 53 });
  const d = await docs.boundingBox(), f = await footer.boundingBox(), p = await pill.boundingBox();
  expect(d?.x).toBe(width < 768 ? 0 : mainWidth);
  expect(d?.width).toBe(width < 768 ? width : 288);
  expect(d?.y).toBeCloseTo(width < 768 ? height * 0.8 : 0, 1);
  expect(f?.height).toBeCloseTo(footerHeight, 1);
  expect(f?.y).toBeCloseTo((width < 768 ? height * 0.8 : height) - footerHeight, 1);
  expect(p?.width).toBe(Math.min(768, mainWidth - 32));
  const input = page.locator('textarea').first();
  await expect(header.locator('h1')).toHaveCSS('color', await input.evaluate((element) => getComputedStyle(element).color));
  expect(await input.evaluate(e => { const b=e.getBoundingClientRect(); return document.elementFromPoint(b.x+b.width/2,b.y+b.height/2)===e; })).toBe(true);
  await expect(docs.getByRole('heading', { name: 'About this example' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBe(0);
  await input.fill(Array.from({ length: 10 }, (_, index) => `Draft line ${index + 1}`).join('\n'));
  await expect(input).toHaveCSS('overflow-y', 'auto');
  expect((await input.boundingBox())?.height).toBeLessThanOrEqual(height * 0.2 + 1);
  await input.evaluate((element) => { element.scrollTop = element.scrollHeight; });
  expect(await input.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await input.fill('');
}
