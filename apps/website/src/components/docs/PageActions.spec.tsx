// @vitest-environment jsdom
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const trackMock = vi.hoisted(() => vi.fn());
const writeTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock('../../lib/analytics/client', () => ({ track: trackMock }));

beforeEach(() => {
  trackMock.mockClear();
  writeTextMock.mockClear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({ ok: true, text: () => Promise.resolve('# Streaming\n\nbody') });
  Object.assign(navigator, { clipboard: { writeText: writeTextMock } });
  Object.assign(globalThis, { fetch: fetchMock });
});

const headings = [
  { id: 'overview', text: 'Overview', level: 2 as const },
  { id: 'details', text: 'Details', level: 3 as const },
];

async function renderActions() {
  const { PageActions } = await import('./PageActions');
  render(
    <PageActions
      library="langgraph"
      section="guides"
      slug="streaming"
      headings={headings}
    />,
  );
}

async function open() {
  await renderActions();
  fireEvent.click(screen.getByRole('button', { name: /page actions/i }));
}

describe('PageActions', () => {
  it('describes the closed trigger with a tooltip and restores it after Escape', async () => {
    await renderActions();
    const trigger = screen.getByRole('button', { name: 'Page actions' });
    const tooltip = screen.getByRole('tooltip');

    expect(trigger.getAttribute('aria-label')).toBe('Page actions');
    expect(trigger.getAttribute('aria-describedby')).toBe(tooltip.id);
    expect(tooltip.textContent).toBe('Page actions');
    expect(trigger.nextElementSibling).toBe(tooltip);

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-label')).toBe('Page actions');
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    const restoredTooltip = screen.getByRole('tooltip');
    expect(trigger.getAttribute('aria-describedby')).toBe(restoredTooltip.id);
    expect(restoredTooltip.textContent).toBe('Page actions');
  });

  it('dismisses the closed tooltip with Escape without moving trigger focus', async () => {
    await renderActions();
    const trigger = screen.getByRole('button', { name: 'Page actions' });
    trigger.focus();
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.keyDown(document, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.activeElement).toBe(trigger);
    expect(trigger.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps a dismissed tooltip closed until a new focus or pointer cycle', async () => {
    await renderActions();
    const trigger = screen.getByRole('button', { name: 'Page actions' });
    trigger.focus();
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());

    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(screen.queryByRole('tooltip')).toBeNull();

    fireEvent.blur(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.focus(trigger);
    await waitFor(() => expect(screen.getByRole('tooltip')).toBeTruthy());

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    fireEvent.pointerMove(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerLeave(trigger);
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.pointerEnter(trigger);
    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('uses one ellipsis trigger and keeps utilities inside its menu', async () => {
    await renderActions();
    expect(screen.getByRole('button', { name: /page actions/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /copy page as markdown/i })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /page actions/i }));
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual([
      'On this page',
      'Copy page as Markdown',
      'Open in ChatGPT',
      'View as Markdown',
      'Edit on GitHub',
    ]);
  });

  it('copies raw Markdown from the route and fires analytics', async () => {
    await open();
    fireEvent.click(screen.getByRole('menuitem', { name: /copy page as markdown/i }));
    await waitFor(() => expect(writeTextMock).toHaveBeenCalledWith('# Streaming\n\nbody'));
    expect(fetchMock).toHaveBeenCalledWith('/api/markdown/langgraph/guides/streaming');
    expect(trackMock).toHaveBeenCalledWith(
      'docs:copy_code_click',
      expect.objectContaining({ surface: 'docs', cta_id: 'copy_page_markdown' }),
    );
    expect(screen.getByRole('menuitem', { name: /copied/i })).toBeTruthy();
  });

  it('keeps the menu usable and never reports success after copy failure', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    await open();
    fireEvent.click(screen.getByRole('menuitem', { name: /copy page as markdown/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByRole('menuitem', { name: /copied/i })).toBeNull();
    expect(screen.getByRole('menuitem', { name: /copy page as markdown/i })).toBeTruthy();
  });

  it('focuses the wide table of contents from On this page', async () => {
    const toc = document.createElement('aside');
    toc.id = 'docs-on-this-page';
    toc.tabIndex = -1;
    Object.defineProperty(toc, 'getClientRects', { value: () => [{ width: 100 }] });
    document.body.append(toc);
    await open();

    fireEvent.click(screen.getByRole('menuitem', { name: /on this page/i }));
    expect(document.activeElement).toBe(toc);
    expect(screen.queryByRole('menu')).toBeNull();
    toc.remove();
  });

  it('reveals heading links in the menu when the wide TOC is unavailable', async () => {
    await open();
    fireEvent.click(screen.getByRole('menuitem', { name: /on this page/i }));
    expect(screen.getByRole('menuitem', { name: 'Overview' }).getAttribute('href')).toBe('#overview');
    expect(screen.getByRole('menuitem', { name: 'Details' }).getAttribute('href')).toBe('#details');
  });

  it('supports menu keyboard navigation and restores trigger focus on Escape', async () => {
    await open();
    const items = screen.getAllByRole('menuitem');
    const last = items.at(-1);
    if (!last) throw new Error('Expected page action items');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    fireEvent.keyDown(items[0], { key: 'End' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: /page actions/i })));
  });

  it('links to ChatGPT with the page URL and to GitHub edit', async () => {
    await open();
    const chatgpt = screen.getByRole('menuitem', { name: /open in chatgpt/i }) as HTMLAnchorElement;
    expect(chatgpt.getAttribute('href')).toContain('https://chatgpt.com/?hints=search&q=');
    expect(chatgpt.getAttribute('href')).toContain(encodeURIComponent('https://threadplane.ai/docs/langgraph/guides/streaming'));
    const github = screen.getByRole('menuitem', { name: /edit on github/i }) as HTMLAnchorElement;
    expect(github.getAttribute('href')).toBe('https://github.com/cacheplane/threadplane/edit/main/apps/website/content/docs/langgraph/guides/streaming.mdx');
  });
});
