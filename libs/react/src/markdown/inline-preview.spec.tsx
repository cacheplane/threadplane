import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMarkdown } from '@threadplane/content/markdown';
import { Markdown } from './markdown.js';
const snapshot = (generation = 'a') =>
  createMarkdown({
    generation,
    phase: 'complete',
    content: 'See [^a] [^missing] [outer [^a]](/outer)',
  }).getSnapshot();
const source = {
  id: 'a',
  index: 3,
  title: '<b>Literal</b>',
  snippet: '<img src=x>',
  url: '/safe',
};
function setup() {
  return render(
    <>
      <Markdown snapshot={snapshot()} citations={[source]} citationPreview />
      <button>After</button>
    </>
  );
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('inline previews', () => {
  it('opts in resolved markers, renders literal metadata and safe navigation in a body portal', () => {
    const v = setup();
    const trigger = v.getAllByRole('button', {
      name: 'Citation 3: <b>Literal</b>',
    })[0];
    fireEvent.click(trigger);
    const dialog = v.getByRole('dialog', { name: 'Source 3' });
    expect(dialog.parentElement).toBe(document.body);
    expect(dialog.querySelector('img,b')).toBeNull();
    expect(
      v.getByRole('link', { name: 'Open source' }).getAttribute('href')
    ).toBe('/safe');
    expect(v.getByLabelText('Unresolved citation missing').textContent).toBe(
      '[^missing]'
    );
    expect(v.container.querySelector('a button')).toBeNull();
  });
  it('opens on focus, bridges Tab without trapping, and suppresses reopening after explicit dismissal', () => {
    const v = setup();
    const trigger = v.getAllByRole('button', {
      name: 'Citation 3: <b>Literal</b>',
    })[0];
    act(() => trigger.focus());
    expect(v.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Tab' });
    const close = v.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(trigger);
    fireEvent.keyDown(trigger, { key: 'Tab' });
    fireEvent.click(close);
    expect(document.activeElement).toBe(trigger);
    expect(v.queryByRole('dialog')).toBeNull();
    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: 'Tab' });
    act(() => v.getByRole('link', { name: 'Open source' }).focus());
    fireEvent.keyDown(v.getByRole('link', { name: 'Open source' }), {
      key: 'Tab',
    });
    expect(v.queryByRole('dialog')).toBeNull();
    expect(document.activeElement?.getAttribute('href')).toBe('/outer');
  });
  it('delays fine pointer hover, transfers into card, and never closes while focus is owned', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const v = setup();
    const trigger = v.getAllByRole('button', {
      name: 'Citation 3: <b>Literal</b>',
    })[0];
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    act(() => vi.advanceTimersByTime(119));
    expect(v.queryByRole('dialog')).toBeNull();
    act(() => vi.advanceTimersByTime(1));
    const panel = v.getByRole('dialog');
    fireEvent.pointerLeave(trigger);
    fireEvent.pointerEnter(panel);
    act(() => vi.advanceTimersByTime(200));
    expect(v.getByRole('dialog')).toBeTruthy();
    act(() => trigger.focus());
    fireEvent.pointerLeave(panel);
    act(() => vi.advanceTimersByTime(201));
    expect(v.getByRole('dialog')).toBeTruthy();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(v.queryByRole('dialog')).toBeNull();
  });
  it('retires timers on generation change and removes unsafe links while updating same-ID metadata', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const v = setup();
    const trigger = v.getAllByRole('button', {
      name: 'Citation 3: <b>Literal</b>',
    })[0];
    fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
    v.rerender(
      <Markdown snapshot={snapshot('b')} citations={[source]} citationPreview />
    );
    act(() => vi.advanceTimersByTime(500));
    expect(v.queryByRole('dialog')).toBeNull();
    fireEvent.click(v.getAllByRole('button')[0]);
    v.rerender(
      <Markdown
        snapshot={snapshot('b')}
        citations={[{ ...source, url: 'javascript:evil', title: 'Updated' }]}
        citationPreview
      />
    );
    expect(v.getByRole('dialog').textContent).toContain('Updated');
    expect(v.queryByRole('link', { name: 'Open source' })).toBeNull();
    v.rerender(<Markdown snapshot={snapshot('b')} citationPreview />);
    expect(v.queryByRole('dialog')).toBeNull();
  });
});

it('keeps touch hover inert, contains modified keyboard activation, and dismisses outside without stealing focus', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  const v = setup();
  const trigger = v.getAllByRole('button', {
    name: 'Citation 3: <b>Literal</b>',
  })[0];
  fireEvent.pointerEnter(trigger, { pointerType: 'touch' });
  act(() => vi.advanceTimersByTime(500));
  expect(v.queryByRole('dialog')).toBeNull();
  fireEvent.keyDown(trigger, { key: 'Enter', ctrlKey: true });
  expect(v.queryByRole('dialog')).toBeNull();
  fireEvent.click(trigger);
  const after = v.getByRole('button', { name: 'After' });
  fireEvent.pointerDown(after);
  act(() => after.focus());
  expect(v.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(after);
});
it('cancels queued hover on hidden document and on real focus departure', () => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  const v = setup();
  const trigger = v.getAllByRole('button', {
    name: 'Citation 3: <b>Literal</b>',
  })[0];
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  act(() => v.getByRole('button', { name: 'After' }).focus());
  act(() => vi.advanceTimersByTime(500));
  expect(v.queryByRole('dialog')).toBeNull();
  fireEvent.pointerEnter(trigger, { pointerType: 'mouse' });
  fireEvent(window, new Event('blur'));
  act(() => vi.advanceTimersByTime(500));
  expect(v.queryByRole('dialog')).toBeNull();
});
it('keeps the default link and prevents interactive nested citations even with opt-in', () => {
  const v = render(<Markdown snapshot={snapshot()} citations={[source]} />);
  expect(v.queryByRole('button')).toBeNull();
  expect(v.getAllByRole('link')).toHaveLength(2);
  v.rerender(
    <Markdown snapshot={snapshot()} citations={[source]} citationPreview />
  );
  expect(v.getAllByRole('button')).toHaveLength(1);
  expect(v.container.querySelector('a sup')?.textContent).toBe('[3]');
});
it('carries inherited typography and source theme into its owner-document portal', () => {
  const v = render(
    <div
      style={
        {
          fontFamily: 'monospace',
          '--ds-surface': 'rgb(1, 2, 3)',
        } as React.CSSProperties
      }
    >
      <Markdown snapshot={snapshot()} citations={[source]} citationPreview />
    </div>
  );
  const trigger = v.getAllByRole('button')[0];
  trigger.style.fontFamily = 'monospace';
  trigger.style.setProperty('--ds-surface', 'rgb(1, 2, 3)');
  fireEvent.click(trigger);
  expect(v.getByRole('dialog').style.fontFamily).toBe(
    getComputedStyle(trigger).fontFamily
  );
  expect(v.getByRole('dialog').style.background).toBe('rgb(1, 2, 3)');
});
it('contains card keyup and rejects a composing or repeated Space release', () => {
  const keyup = vi.fn();
  const v = render(
    <div onKeyUp={keyup}>
      <Markdown snapshot={snapshot()} citations={[source]} citationPreview />
    </div>
  );
  fireEvent.click(v.getAllByRole('button')[0]);
  const close = v.getByRole('button', { name: 'Close' });
  fireEvent.keyDown(close, { key: ' ', isComposing: true });
  expect(fireEvent.keyUp(close, { key: ' ' })).toBe(false);
  expect(keyup).not.toHaveBeenCalled();
  expect(v.getByRole('dialog')).toBeTruthy();
  fireEvent.keyDown(close, { key: 'Enter', repeat: true });
  expect(v.getByRole('dialog')).toBeTruthy();
});
it('skips hidden ancestor and inert controls when resuming logical page focus', () => {
  const v = render(
    <>
      <Markdown
        snapshot={createMarkdown({
          generation: 'a',
          phase: 'complete',
          content: '[^a]',
        }).getSnapshot()}
        citations={[source]}
        citationPreview
      />
      <div style={{ display: 'none' }}>
        <button>Hidden</button>
      </div>
      <div inert>
        <button>Inert</button>
      </div>
      <button>Next</button>
    </>
  );
  fireEvent.click(
    v.getAllByRole('button', { name: 'Citation 3: <b>Literal</b>' })[0]
  );
  const link = v.getByRole('link', { name: 'Open source' });
  act(() => link.focus());
  fireEvent.keyDown(link, { key: 'Tab' });
  expect(document.activeElement?.textContent).toBe('Next');
});
it('dismisses when card focus leaves to the document body', () => {
  const v = setup();
  fireEvent.click(v.getAllByRole('button')[0]);
  const close = v.getByRole('button', { name: 'Close' });
  act(() => close.focus());
  act(() => close.blur());
  expect(v.queryByRole('dialog')).toBeNull();
});
it('resumes native tab order through editable page controls after positive tab stops', () => {
  const v = render(
    <>
      <Markdown
        snapshot={createMarkdown({
          generation: 'a',
          phase: 'complete',
          content: '[^a]',
        }).getSnapshot()}
        citations={[source]}
        citationPreview
      />
      <button tabIndex={1}>Earlier tab stop</button>
      <div contentEditable suppressContentEditableWarning>
        Editor
      </div>
      <button>Next</button>
    </>
  );
  fireEvent.click(
    v.getAllByRole('button', { name: 'Citation 3: <b>Literal</b>' })[0]
  );
  const link = v.getByRole('link', { name: 'Open source' });
  act(() => link.focus());
  fireEvent.keyDown(link, { key: 'Tab' });
  expect(document.activeElement?.textContent).toBe('Editor');
});
it('skips concealed details controls and resumes at the next summary', () => {
  const v = render(
    <>
      <Markdown
        snapshot={createMarkdown({
          generation: 'a',
          phase: 'complete',
          content: '[^a]',
        }).getSnapshot()}
        citations={[source]}
        citationPreview
      />
      <details>
        <summary tabIndex={-1}>Skipped summary</summary>
        <button>Concealed</button>
      </details>
      <details>
        <summary>Next disclosure</summary>
        <button>Concealed next</button>
      </details>
    </>
  );
  fireEvent.click(
    v.getAllByRole('button', { name: 'Citation 3: <b>Literal</b>' })[0]
  );
  const link = v.getByRole('link', { name: 'Open source' });
  act(() => link.focus());
  fireEvent.keyDown(link, { key: 'Tab' });
  expect(document.activeElement?.textContent).toBe('Next disclosure');
});
it('constrains card dimensions to the offset visual viewport', () => {
  vi.stubGlobal('visualViewport', {
    width: 180,
    height: 150,
    offsetLeft: 20,
    offsetTop: 30,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  });
  const v = setup();
  fireEvent.click(v.getAllByRole('button')[0]);
  const card = v.getByRole('dialog');
  expect(card.style.maxWidth).toBe('164px');
  expect(card.style.maxHeight).toBe('134px');
  expect(Number.parseFloat(card.style.left)).toBeGreaterThanOrEqual(28);
  expect(Number.parseFloat(card.style.top)).toBeGreaterThanOrEqual(38);
});
it('opens on first focus after an outside pointer while no preview is open', () => {
  const v = setup();
  fireEvent.pointerDown(document.body);
  const trigger = v.getAllByRole('button', {
    name: 'Citation 3: <b>Literal</b>',
  })[0];
  act(() => trigger.focus());
  expect(v.getByRole('dialog', { name: 'Source 3' })).toBeTruthy();
});
it('requires literal true to opt in from JavaScript callers', () => {
  const v = render(
    <Markdown
      snapshot={snapshot()}
      citations={[source]}
      citationPreview={'yes' as unknown as boolean}
    />
  );
  expect(v.queryByRole('button')).toBeNull();
  expect(v.getAllByRole('link')).toHaveLength(2);
});
