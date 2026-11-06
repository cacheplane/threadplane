import { cleanup, fireEvent, render } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Citation } from '@threadplane/core';
import { Citations } from './index';
import {
  createMarkdown,
  type MarkdownSnapshot,
} from '@threadplane/content/markdown';

const owners: ReturnType<typeof createMarkdown>[] = [];
const markdown = (content: string) => {
  const owner = createMarkdown({ generation: 'a', phase: 'complete', content });
  owners.push(owner);
  return owner.getSnapshot();
};
const sidecars = (
  citations: readonly Citation[],
  snapshot?: MarkdownSnapshot,
  preview = false
) => (
  <Citations
    {...({
      citations,
      snapshot,
      preview,
      collapsible: true,
    } as React.ComponentProps<typeof Citations>)}
  />
);

afterEach(() => {
  cleanup();
  for (const owner of owners.splice(0)) owner.dispose();
});
describe('Markdown Sources sidecars', () => {
  it('opts into stable numeric order and exact whole provider overrides without mutating inputs', () => {
    const snapshot = markdown(
      '[^constructor]: Constructor [link](/constructor) tail\n\n[^__proto__]: Hidden [link](/fallback) hidden snippet\n\n[^Case]: Upper\n\n[^case]: Lower\n'
    );
    const citations = Object.freeze([
      Object.freeze({ id: '__proto__', index: 3, url: 'javascript:blocked' }),
      Object.freeze({ id: 'provider', index: 1, title: 'Provider' }),
    ]);
    if (!snapshot.root) throw new Error('Expected accepted Markdown root');
    const before = [...snapshot.root.citations];
    const view = render(sidecars(citations));
    fireEvent.click(view.getByRole('button'));
    expect(
      view.getAllByRole('listitem').map((item) => item.textContent)
    ).toEqual(['[3] javascript:blocked', '[1] Provider']);
    view.rerender(sidecars(citations, snapshot));
    expect(view.getByRole('button').textContent).toBe('Sources (5)');
    expect(
      view.getAllByRole('listitem').map((item) => item.textContent)
    ).toEqual([
      '[1] Provider',
      '[1] Constructortail',
      '[3] javascript:blocked',
      '[3] Upper',
      '[4] Lower',
    ]);
    expect(view.queryByText('hidden snippet')).toBeNull();
    expect(
      view.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(['/constructor']);
    expect([...snapshot.root.citations]).toEqual(before);
    expect(citations[0]).toEqual({
      id: '__proto__',
      index: 3,
      url: 'javascript:blocked',
    });
  });
  it('uses empty and null roots as an explicit sorting opt-in and rejects duplicate providers closed', () => {
    const snapshot = markdown('');
    const view = render(sidecars([], snapshot));
    expect(view.container.childElementCount).toBe(0);
    for (const input of [snapshot, { ...snapshot, root: null }]) {
      view.rerender(
        sidecars(
          [
            { id: 'b', index: 2 },
            { id: 'a', index: 1 },
          ],
          input
        )
      );
      fireEvent.click(view.getByRole('button'));
      expect(
        view.getAllByRole('listitem').map((item) => item.textContent)
      ).toEqual(['[1] Source 1', '[2] Source 2']);
      fireEvent.click(view.getByRole('button'));
    }
    expect(() =>
      view.rerender(
        sidecars(
          [
            { id: 'a', index: 1 },
            { id: 'a', index: 2 },
          ],
          snapshot
        )
      )
    ).toThrow(/duplicate citation/i);
  });
  it('keeps expanded state, keyed rows and an open preview through corrections, and retires removed sources', () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    });
    const owner = createMarkdown(
      {
        generation: 'a',
        phase: 'streaming',
        content: '[^a]: Original [link](/first) first snippet\n',
      },
      { violationPolicy: 'rebuild' }
    );
    owners.push(owner);
    const view = render(sidecars([], owner.getSnapshot(), true));
    const header = view.getByRole('button', { name: 'Sources (1)' });
    fireEvent.click(header);
    const item = view.getByRole('listitem');
    const trigger = view.getByRole('button', {
      name: 'Preview source 1: Original',
    });
    fireEvent.click(trigger);
    const card = view.getByRole('dialog');
    owner.update({
      generation: 'a',
      phase: 'streaming',
      content:
        '[^a]: Corrected [link](/next) corrected snippet\n\n[^b]: Added\n',
    });
    view.rerender(sidecars([], owner.getSnapshot(), true));
    expect(view.getByRole('button', { name: 'Sources (2)' })).toBe(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByRole('listitem')[0]).toBe(item);
    expect(view.getByRole('dialog')).toBe(card);
    expect(card.textContent).toContain('corrected snippet');
    expect(view.getByRole('link').getAttribute('href')).toBe('/next');
    owner.update({
      generation: 'a',
      phase: 'complete',
      content: '[^b]: Added\n',
    });
    view.rerender(sidecars([], owner.getSnapshot(), true));
    expect(item.isConnected).toBe(false);
    expect(card.isConnected).toBe(false);
    fireEvent.click(trigger);
    expect(view.queryByRole('dialog')).toBeNull();
  });
});
describe('Citations', () => {
  it('opts into explicit preview buttons only for literal true', () => {
    const citations = [
      { id: 'a', index: 1, title: 'Evidence', url: 'https://example.com' },
    ];
    const view = render(<Citations {...{ citations, preview: true }} />);
    expect(
      view.getByRole('button', { name: 'Preview source 1: Evidence' })
    ).toBeTruthy();
    expect(view.queryByRole('link')).toBeNull();
    for (const preview of [false, undefined, 'true', 1]) {
      view.rerender(
        <Citations
          {...({ citations, preview } as unknown as React.ComponentProps<
            typeof Citations
          >)}
        />
      );
      expect(view.queryByRole('button')).toBeNull();
      expect(view.getByRole('link').getAttribute('href')).toBe(
        'https://example.com'
      );
    }
  });
  it('hides empty sources and borrows literal metadata without fetching icons', () => {
    const view = render(<Citations citations={[]} />);
    expect(view.container.childElementCount).toBe(0);
    const citations = Object.freeze([
      Object.freeze({
        id: '__proto__',
        index: 7,
        title: '<b>Source</b>',
        snippet: '<img src=x>\nLine',
        sourceType: 'Authored',
        iconUrl: 'https://images.invalid/icon',
      }),
    ]);
    view.rerender(
      <Citations citations={citations} label="Evidence" className="extra" />
    );
    const region = view.getByRole('region', { name: 'Evidence' });
    expect(region.className).toContain('extra');
    expect(view.getByRole('heading').textContent).toBe('Evidence');
    expect(region.textContent).toContain('[7]');
    expect(region.textContent).toContain('<b>Source</b>');
    expect(region.textContent).toContain('<img src=x>\nLine');
    expect(region.querySelector('img, script, b')).toBeNull();
    expect(view.queryByRole('link')).toBeNull();
    expect(citations[0].title).toBe('<b>Source</b>');
  });
  it('uses the existing destination policy and preserves absent versus empty text', () => {
    const urls = [
      'https://example.com/a',
      '/relative',
      'mailto:test@example.com',
      'javascript:alert(1)',
      'data:text/html,test',
      'java\nscript:alert(1)',
      '',
    ];
    const citations: readonly Citation[] = urls.map((url, index) => ({
      id: String(index),
      index,
      url,
    }));
    const view = render(
      <Citations
        citations={[
          ...citations,
          { id: 'empty', index: 10, title: '', snippet: '', sourceType: '' },
          { id: 'missing', index: 11 },
        ]}
      />
    );
    expect(
      view.getAllByRole('link').map((link) => link.getAttribute('href'))
    ).toEqual(urls.slice(0, 3));
    for (const link of view.getAllByRole('link')) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
    expect(view.container.textContent).toContain('javascript:alert(1)');
    const items = view.getAllByRole('listitem');
    expect(items[7].querySelector('.tp-citations__title')?.textContent).toBe(
      ''
    );
    expect(items[7].querySelector('.tp-citations__snippet')?.textContent).toBe(
      ''
    );
    expect(items[7].querySelector('.tp-citations__type')?.textContent).toBe('');
    expect(items[8].querySelector('.tp-citations__title')?.textContent).toBe(
      'Source 11'
    );
  });
  it('preserves keyed items across update/reorder and rejects duplicate IDs', () => {
    const view = render(
      <Citations
        citations={[
          { id: '', index: 2, title: 'A' },
          { id: 'b', index: 1, title: 'B' },
        ]}
      />
    );
    const first = view.getAllByRole('listitem')[0];
    view.rerender(
      <Citations
        citations={[
          { id: 'b', index: 1, title: 'B' },
          { id: '', index: 2, title: 'Changed' },
        ]}
      />
    );
    expect(view.getAllByRole('listitem')[1]).toBe(first);
    expect(first.textContent).toContain('Changed');
    expect(() =>
      view.rerender(
        <Citations
          citations={[
            { id: 'same', index: 1 },
            { id: 'same', index: 2 },
          ]}
        />
      )
    ).toThrow(/duplicate citation/i);
  });
});

describe('collapsible Citations', () => {
  const citations = [{ id: 'a', index: 7, title: 'Evidence', url: '/raw' }];
  // Runtime probes also exercise invalid JavaScript flags before the declaration exists.
  const panel = (extra: Record<string, unknown> = {}) => (
    <Citations
      {...({ citations, collapsible: true, ...extra } as React.ComponentProps<
        typeof Citations
      >)}
    />
  );
  it('starts closed with a counted native heading button and stable unique existing hidden body', () => {
    const view = render(
      <StrictMode>
        {panel()}
        {panel({ label: 'Evidence' })}
      </StrictMode>
    );
    const header = view.getByRole('button', { name: 'Sources (1)' });
    expect(header.tagName).toBe('BUTTON');
    expect(header.getAttribute('type')).toBe('button');
    expect(header.parentElement?.tagName).toBe('H4');
    expect(header.getAttribute('aria-expanded')).toBe('false');
    const id = header.getAttribute('aria-controls');
    if (!id) throw new Error('Expected Sources body ID');
    const body = document.getElementById(id);
    if (!body) throw new Error('Expected Sources body');
    expect(body.hidden).toBe(true);
    expect(body.childElementCount).toBe(0);
    expect(view.queryByRole('link')).toBeNull();
    expect(
      view
        .getByRole('button', { name: 'Evidence (1)' })
        .getAttribute('aria-controls')
    ).not.toBe(id);
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(body.hidden).toBe(false);
    expect(view.getByRole('link').getAttribute('href')).toBe('/raw');
    fireEvent.click(header);
    expect(body.hidden).toBe(true);
    expect(body.childElementCount).toBe(0);
    expect(header.getAttribute('aria-controls')).toBe(id);
  });
  it('preserves expanded choice and keyed items for count, metadata and reorder updates', () => {
    const view = render(panel());
    const header = view.getByRole('button');
    fireEvent.click(header);
    const item = view.getByRole('listitem');
    view.rerender(
      panel({
        citations: [
          { id: 'b', index: 2 },
          { ...citations[0], title: 'Changed' },
        ],
      })
    );
    expect(view.getByRole('button', { name: 'Sources (2)' })).toBe(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(view.getAllByRole('listitem')[1]).toBe(item);
    expect(item.textContent).toContain('Changed');
    fireEvent.click(header);
    view.rerender(panel());
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByRole('listitem')).toBeNull();
  });
  it('uses strict opt-in and retires presentation across mode changes, empty and unmount', () => {
    const view = render(panel());
    fireEvent.click(view.getByRole('button'));
    const old = view.getByRole('listitem');
    for (const collapsible of [undefined, false, 'true', 1]) {
      view.rerender(panel({ collapsible }));
      expect(view.queryByRole('button')).toBeNull();
      expect(view.getByRole('heading').textContent).toBe('Sources');
    }
    expect(old.isConnected).toBe(false);
    view.rerender(panel());
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    fireEvent.click(view.getByRole('button'));
    view.rerender(panel({ citations: [] }));
    expect(view.container.childElementCount).toBe(0);
    view.rerender(panel());
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
      'false'
    );
    view.unmount();
    expect(view.container.childElementCount).toBe(0);
  });
  it('rejects duplicate IDs before opening', () => {
    expect(() =>
      render(panel({ citations: [citations[0], citations[0]] }))
    ).toThrow(/duplicate citation/i);
  });
  it('contains keyboard and click bubbling while preserving native activation and Tab', () => {
    const outer = vi.fn();
    const view = render(
      <div onKeyDown={outer} onKeyUp={outer} onClick={outer}>
        {panel()}
      </div>
    );
    const header = view.getByRole('button');
    for (const key of ['Enter', ' ', 'Tab']) {
      const down = new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
      });
      const up = new KeyboardEvent('keyup', {
        key,
        bubbles: true,
        cancelable: true,
      });
      fireEvent(header, down);
      fireEvent(header, up);
      expect(down.defaultPrevented).toBe(false);
      expect(up.defaultPrevented).toBe(false);
    }
    fireEvent.click(header);
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(outer).not.toHaveBeenCalled();
  });
  it.each([
    { repeat: true },
    { isComposing: true },
    { keyCode: 229 },
    { claimed: true },
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { shiftKey: true },
  ])(
    'rejects ignored keyboard activation and later Space release: %j',
    (extra) => {
      const view = render(panel());
      const header = view.getByRole('button');
      for (const key of ['Enter', ' ']) {
        const down = new KeyboardEvent('keydown', {
          key,
          bubbles: true,
          cancelable: true,
          ...extra,
        });
        if ('claimed' in extra) down.preventDefault();
        fireEvent(header, down);
        expect(down.defaultPrevented).toBe(true);
        const up = new KeyboardEvent('keyup', {
          key,
          bubbles: true,
          cancelable: true,
        });
        fireEvent(header, up);
        if (key === ' ') expect(up.defaultPrevented).toBe(true);
      }
      expect(header.getAttribute('aria-expanded')).toBe('false');
    }
  );
  it('clears Space ownership on blur, window blur and hidden document', () => {
    const view = render(panel());
    const header = view.getByRole('button');
    for (const release of [
      () => fireEvent.blur(header),
      () => fireEvent(window, new Event('blur')),
      () => {
        vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
        fireEvent(document, new Event('visibilitychange'));
      },
    ]) {
      fireEvent.keyDown(header, { key: ' ' });
      release();
      const up = new KeyboardEvent('keyup', {
        key: ' ',
        bubbles: true,
        cancelable: true,
      });
      fireEvent(header, up);
      expect(up.defaultPrevented).toBe(true);
    }
    vi.restoreAllMocks();
  });
  it('restores available header from a closing list descendant without stealing outside focus', () => {
    vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue([
      {},
    ] as unknown as DOMRectList);
    const view = render(
      <>
        {panel()}
        <button>Outside</button>
      </>
    );
    const header = view.getByRole('button', { name: 'Sources (1)' });
    fireEvent.click(header);
    view.getByRole('link').focus();
    fireEvent.click(header);
    expect(document.activeElement).toBe(header);
    fireEvent.click(header);
    const outside = view.getByRole('button', { name: 'Outside' });
    outside.focus();
    fireEvent.click(header);
    expect(document.activeElement).toBe(outside);
    fireEvent.click(header);
    view.getByRole('link').focus();
    header.hidden = true;
    fireEvent.click(header);
    expect(document.activeElement).not.toBe(header);
    vi.restoreAllMocks();
  });
  it('retires preview descendants on collapse and opens fresh controls on expansion', () => {
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
      configurable: true,
      value() {
        this.setAttribute('open', '');
      },
    });
    Object.defineProperty(HTMLDialogElement.prototype, 'close', {
      configurable: true,
      value() {
        this.removeAttribute('open');
      },
    });
    const view = render(panel({ preview: true }));
    const header = view.getByRole('button');
    fireEvent.click(header);
    const trigger = view.getByRole('button', { name: /^Preview source/ });
    fireEvent.click(trigger);
    const dialog = view.getByRole('dialog');
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    fireEvent.click(header);
    expect(trigger.isConnected).toBe(false);
    expect(dialog.isConnected).toBe(false);
    fireEvent.click(header);
    expect(view.getByRole('button', { name: /^Preview source/ })).not.toBe(
      trigger
    );
    fireEvent.click(trigger);
    expect(view.queryByRole('dialog')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: /^Preview source/ }));
    view.rerender(panel({ collapsible: false, preview: true }));
    expect(view.queryByRole('dialog')).toBeNull();
  });
});
