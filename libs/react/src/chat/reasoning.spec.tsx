import { StrictMode } from 'react';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createMarkdown } from '@threadplane/content/markdown';
import { Reasoning } from './index';

afterEach(cleanup);
const owner = (
  phase: 'complete' | 'streaming' = 'complete',
  generation = 'g:reasoning',
  content = '**Why**'
) =>
  createMarkdown(
    { generation, phase, content },
    { violationPolicy: 'rebuild' }
  );

describe('Reasoning', () => {
  it('hides empty content, then renders an owned Markdown disclosure', () => {
    const source = owner('complete', 'g', '');
    const view = render(<Reasoning snapshot={source.getSnapshot()} />);
    expect(view.container.childElementCount).toBe(0);
    source.update({ generation: 'g', phase: 'complete', content: '**Why**' });
    view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
    const button = view.getByRole('button', { name: 'Show reasoning' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    expect(view.queryByRole('region', { name: 'Reasoning' })).toBeNull();
    fireEvent.click(button);
    const body = view.getByRole('region', { name: 'Reasoning' });
    expect(body.querySelector('strong')?.textContent).toBe('Why');
    expect(button.getAttribute('aria-controls')).toBe(body.id);
    source.dispose();
  });

  it('automatically opens streaming and collapses on completion without a manual choice', () => {
    const source = owner('streaming');
    const view = render(<Reasoning snapshot={source.getSnapshot()} />);
    expect(
      view
        .getByRole('button', { name: 'Thinking…' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    source.update({ ...source.getSnapshot().document, phase: 'complete' });
    view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
    expect(
      view
        .getByRole('button', { name: 'Show reasoning' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    source.dispose();
  });

  it.each([true, false])(
    'preserves a manual %s choice through append, correction and completion',
    (expanded) => {
      const source = owner('streaming');
      const view = render(<Reasoning snapshot={source.getSnapshot()} />);
      const button = view.getByRole('button');
      fireEvent.click(button);
      if (expanded) fireEvent.click(button);
      for (const content of ['**Why** more', 'Correction']) {
        source.update({ ...source.getSnapshot().document, content });
        view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
        expect(button.getAttribute('aria-expanded')).toBe(String(expanded));
      }
      source.update({ ...source.getSnapshot().document, phase: 'complete' });
      view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
      expect(button.getAttribute('aria-expanded')).toBe(String(expanded));
      source.dispose();
    }
  );

  it.each(['streaming', 'complete'] as const)(
    'resets the manual choice on a new %s generation',
    (phase) => {
      const source = owner(phase);
      const view = render(<Reasoning snapshot={source.getSnapshot()} />);
      const button = view.getByRole('button');
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe(
        String(phase !== 'streaming')
      );
      source.update({ generation: 'new:reasoning', phase, content: 'Next' });
      view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
      expect(view.getByRole('button').getAttribute('aria-expanded')).toBe(
        String(phase === 'streaming')
      );
      source.dispose();
    }
  );

  it('resets a closed override when completed content reopens in the same generation', () => {
    const source = owner('streaming');
    const view = render(<Reasoning snapshot={source.getSnapshot()} />);
    fireEvent.click(view.getByRole('button'));
    source.update({ ...source.getSnapshot().document, phase: 'complete' });
    view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
    source.update({ ...source.getSnapshot().document, phase: 'streaming' });
    view.rerender(<Reasoning snapshot={source.getSnapshot()} />);
    expect(
      view
        .getByRole('button', { name: 'Thinking…' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    source.dispose();
  });

  it.each([
    [0, '<1s'],
    [999, '<1s'],
    [1999, '1s'],
    [60000, '1m 0s'],
    [123456, '2m 3s'],
    [Number.NaN, '<1s'],
    [Infinity, '<1s'],
    [-1, '<1s'],
  ])('formats app-supplied duration %s as %s', (durationMs, text) => {
    const source = owner();
    const view = render(
      <Reasoning snapshot={source.getSnapshot()} durationMs={durationMs} />
    );
    expect(
      view.getByRole('button', { name: `Thought for ${text}` })
    ).toBeTruthy();
    source.dispose();
  });

  it('honors label, className and completed default expansion', () => {
    const source = owner();
    const view = render(
      <Reasoning
        snapshot={source.getSnapshot()}
        label="Analysis"
        className="custom"
        defaultExpanded
      />
    );
    expect(
      view
        .getByRole('button', { name: 'Analysis' })
        .getAttribute('aria-expanded')
    ).toBe('true');
    expect(view.container.firstElementChild?.classList.contains('custom')).toBe(
      true
    );
    fireEvent.click(view.getByRole('button'));
    view.rerender(
      <Reasoning
        snapshot={source.getSnapshot()}
        label="Updated"
        defaultExpanded
      />
    );
    expect(
      view
        .getByRole('button', { name: 'Updated' })
        .getAttribute('aria-expanded')
    ).toBe('false');
    source.dispose();
  });

  it('uses stable unique controls and a native button without token announcements', () => {
    const source = owner();
    const view = render(
      <>
        <Reasoning snapshot={source.getSnapshot()} />
        <Reasoning snapshot={source.getSnapshot()} />
      </>
    );
    const buttons = view.getAllByRole('button');
    const targets = buttons.map((button) =>
      button.getAttribute('aria-controls')
    );
    expect(new Set(targets).size).toBe(2);
    for (const button of buttons) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      const target = view.container.querySelector(
        `[id="${button.getAttribute('aria-controls')}"]`
      );
      expect(target?.hasAttribute('hidden')).toBe(true);
      fireEvent.click(button);
      expect(button.getAttribute('aria-expanded')).toBe('true');
    }
    view.rerender(
      <>
        <Reasoning snapshot={source.getSnapshot()} />
        <Reasoning snapshot={source.getSnapshot()} />
      </>
    );
    expect(
      view
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-controls'))
    ).toEqual(targets);
    expect(view.container.querySelector('[aria-live]')).toBeNull();
    source.dispose();
  });

  it('borrows retained snapshots through StrictMode remounts and renders unsafe text literally', () => {
    const source = owner(
      'complete',
      'g',
      '<script>bad()</script>\n\n[blocked](javascript:bad)'
    );
    const snapshot = source.getSnapshot();
    const view = render(
      <StrictMode>
        <Reasoning snapshot={snapshot} defaultExpanded />
      </StrictMode>
    );
    expect(view.container.querySelector('script')).toBeNull();
    expect(view.container.querySelector('a')).toBeNull();
    expect(
      view.getByRole('region', { name: 'Reasoning' }).textContent
    ).toContain('<script>bad()</script>');
    view.unmount();
    expect(source.getSnapshot()).toBe(snapshot);
    source.dispose();
    const remounted = render(<Reasoning snapshot={snapshot} defaultExpanded />);
    expect(
      remounted.getByRole('region', { name: 'Reasoning' }).textContent
    ).toContain('blocked');
  });
});
