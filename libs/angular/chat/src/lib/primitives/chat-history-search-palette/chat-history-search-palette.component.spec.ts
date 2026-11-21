// libs/angular/chat/src/lib/primitives/chat-history-search-palette/chat-history-search-palette.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatHistorySearchPaletteComponent, type ThreadMatch } from './chat-history-search-palette.component';

function render(opts: { open?: boolean; query?: string; results?: ThreadMatch[]; loading?: boolean } = {}) {
  const fixture = TestBed.createComponent(ChatHistorySearchPaletteComponent);
  fixture.componentRef.setInput('open', opts.open ?? true);
  if (opts.query !== undefined) fixture.componentRef.setInput('query', opts.query);
  if (opts.results !== undefined) fixture.componentRef.setInput('results', opts.results);
  if (opts.loading !== undefined) fixture.componentRef.setInput('loading', opts.loading);
  fixture.detectChanges();
  return fixture;
}

describe('ChatHistorySearchPaletteComponent', () => {
  it('renders nothing when open is false', () => {
    const fixture = render({ open: false });
    expect(fixture.nativeElement.querySelector('.chat-history-search-palette')).toBeNull();
  });

  it('renders hint when query is empty and not loading', () => {
    const fixture = render({ query: '', loading: false });
    expect(fixture.nativeElement.querySelector('.chat-history-search-palette__hint')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.chat-history-search-palette__empty')).toBeNull();
  });

  it('renders empty state when query is non-empty and results empty', () => {
    const fixture = render({ query: 'xyz', results: [], loading: false });
    expect(fixture.nativeElement.querySelector('.chat-history-search-palette__empty')).not.toBeNull();
  });

  it('renders skeleton when loading and results empty', () => {
    const fixture = render({ loading: true, results: [] });
    expect(fixture.nativeElement.querySelector('.chat-history-search-palette__skeleton')).not.toBeNull();
  });

  it('renders result rows when results provided', () => {
    const fixture = render({
      query: 'foo',
      results: [
        { id: '1', title: 'First' },
        { id: '2', title: 'Second', subtitle: 'sub' },
      ],
    });
    const rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    expect(rows.length).toBe(2);
    expect(rows[1].textContent).toContain('Second');
    expect(rows[1].textContent).toContain('sub');
  });

  it('marks active row with aria-selected', () => {
    const fixture = render({
      query: 'foo',
      results: [{ id: '1', title: 'First' }, { id: '2', title: 'Second' }],
    });
    const rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
    expect(rows[1].getAttribute('aria-selected')).toBe('false');
  });

  it('ArrowDown advances active index, clamps at end', () => {
    const fixture = render({
      query: 'foo',
      results: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }],
    });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    let rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    fixture.detectChanges();
    rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    expect(rows[1].getAttribute('aria-selected')).toBe('true');
  });

  it('ArrowUp moves active index back, clamps at 0', () => {
    const fixture = render({
      query: 'foo',
      results: [{ id: '1', title: 'A' }, { id: '2', title: 'B' }],
    });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
    fixture.detectChanges();
    const rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    expect(rows[0].getAttribute('aria-selected')).toBe('true');
  });

  it('Enter emits threadSelected with active row id', () => {
    const fixture = render({
      query: 'foo',
      results: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    });
    let received: string | undefined;
    fixture.componentInstance.threadSelected.subscribe((id: string) => { received = id; });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(received).toBe('b');
  });

  it('Enter with no results is a no-op', () => {
    const fixture = render({ query: 'x', results: [] });
    let emits = 0;
    fixture.componentInstance.threadSelected.subscribe(() => emits++);
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(emits).toBe(0);
  });

  it('Esc emits close', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.closed.subscribe(() => emits++);
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(emits).toBe(1);
  });

  it('Scrim click emits close', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.closed.subscribe(() => emits++);
    const scrim = fixture.nativeElement.querySelector('.chat-history-search-palette__scrim') as HTMLButtonElement;
    scrim.click();
    expect(emits).toBe(1);
  });

  it('Row click emits threadSelected', () => {
    const fixture = render({
      query: 'x',
      results: [{ id: 'r1', title: 'R1' }, { id: 'r2', title: 'R2' }],
    });
    let received: string | undefined;
    fixture.componentInstance.threadSelected.subscribe((id: string) => { received = id; });
    const rows = fixture.nativeElement.querySelectorAll('.chat-history-search-palette__row');
    (rows[1] as HTMLElement).click();
    expect(received).toBe('r2');
  });

  it('input has correct ARIA attributes', () => {
    const fixture = render({
      query: 'x',
      results: [{ id: '1', title: 'A' }],
    });
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('role')).toBe('combobox');
    expect(input.getAttribute('aria-expanded')).toBe('true');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
  });
});
