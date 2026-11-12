import { StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import * as chat from './index';
import type { TraceState } from './index';

const Trace = chat.Trace;

afterEach(cleanup);

function mount(state?: TraceState, defaultExpanded?: boolean) {
  const view = render(
    <Trace label="Search flights" state={state} defaultExpanded={defaultExpanded}>
      <p>Detail</p>
    </Trace>
  );
  const root = view.container.firstElementChild as HTMLElement;
  const toggle = root.querySelector('button') as HTMLButtonElement;
  const content = root.querySelector('.tp-trace__content') as HTMLElement;
  const set = (next: TraceState, open?: boolean) =>
    view.rerender(
      <Trace label="Search flights" state={next} defaultExpanded={open}>
        <p>Detail</p>
      </Trace>
    );
  return { view, root, toggle, content, set, open: () => !content.hidden };
}

describe('Trace', () => {
  it('is closed while pending or done, and open while running or in error', () => {
    expect(mount().open()).toBe(false);
    expect(mount('pending').open()).toBe(false);
    expect(mount('done').open()).toBe(false);
    expect(mount('running').open()).toBe(true);
    expect(mount('error').open()).toBe(true);
  });

  it('honors defaultExpanded for pending and done only as a starting point', () => {
    expect(mount('done', true).open()).toBe(true);
    expect(mount('pending', true).open()).toBe(true);
    expect(mount('running', false).open()).toBe(true);
  });

  it('names the toggle from its label and meta, wires the disclosure and reports its state', () => {
    const view = render(
      <Trace label="Search <b>flights</b>" icon="*" meta="2s" state="done" className="mine">
        <p>Detail</p>
      </Trace>
    );
    const root = view.container.firstElementChild as HTMLElement;
    const toggle = view.getByRole('button', { name: 'Search <b>flights</b> 2s' });
    expect(root.className).toBe('tp-trace mine');
    expect(root.getAttribute('data-state')).toBe('done');
    expect(root.getAttribute('data-expanded')).toBe('false');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    const content = document.getElementById(toggle.getAttribute('aria-controls') as string) as HTMLElement;
    expect(content.hidden).toBe(true);
    expect(content.textContent).toBe('Detail');
    expect(root.querySelector('b')).toBeNull();
    expect(root.querySelector('.tp-trace__icon')?.getAttribute('aria-hidden')).toBe('true');
    expect(root.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('leaves out the icon and meta wrappers when they are not supplied', () => {
    const { root } = mount('done');
    expect(root.querySelector('.tp-trace__icon')).toBeNull();
    expect(root.querySelector('.tp-trace__meta')).toBeNull();
  });

  it('toggles on a press and keeps the same elements and children mounted', () => {
    const { toggle, content, root, open } = mount('done');
    const detail = content.firstElementChild;
    fireEvent.click(toggle);
    expect(open()).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(root.getAttribute('data-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(open()).toBe(false);
    expect(content.firstElementChild).toBe(detail);
  });

  it('lets the reader close a running trace and keeps it closed when it finishes', () => {
    const { toggle, set, open } = mount('running');
    fireEvent.click(toggle);
    expect(open()).toBe(false);
    set('running');
    expect(open()).toBe(false);
    set('done');
    expect(open()).toBe(false);
  });

  it('closes by itself when a running trace finishes untouched', () => {
    const { set, open } = mount('running');
    set('done');
    expect(open()).toBe(false);
    set('done', true);
    expect(open()).toBe(true);
  });

  it('keeps a manual choice across pending and done', () => {
    const { toggle, set, open } = mount('pending');
    fireEvent.click(toggle);
    set('done');
    expect(open()).toBe(true);
    fireEvent.click(toggle);
    set('pending');
    expect(open()).toBe(false);
  });

  it('opens again when the trace re-enters running or error, dropping the manual choice', () => {
    const { toggle, set, open } = mount('running');
    fireEvent.click(toggle);
    set('done');
    expect(open()).toBe(false);
    set('running');
    expect(open()).toBe(true);
    fireEvent.click(toggle);
    expect(open()).toBe(false);
    set('error');
    expect(open()).toBe(true);
    // The override is gone, so finishing follows the default again.
    set('done');
    expect(open()).toBe(false);
  });

  it('toggles once per press under StrictMode', () => {
    const view = render(
      <StrictMode>
        <Trace label="Step" state="done">
          <p>Detail</p>
        </Trace>
      </StrictMode>
    );
    fireEvent.click(view.getByRole('button'));
    expect(view.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('server renders its starting state', () => {
    const html = renderToString(
      <Trace label="Step" state="running">
        <p>Detail</p>
      </Trace>
    );
    expect(html).toContain('data-state="running"');
    expect(html).toContain('aria-expanded="true"');
    expect(html).not.toContain('hidden=""');
    expect(renderToString(<Trace label="Step" />)).toContain('hidden=""');
  });
});
