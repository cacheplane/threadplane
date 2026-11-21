// libs/angular/chat/src/lib/primitives/chat-overflow-menu/chat-overflow-menu.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatOverflowMenuComponent, type OverflowMenuItem } from './chat-overflow-menu.component';

function render(opts: { open?: boolean; items?: OverflowMenuItem[] } = {}) {
  const fixture = TestBed.createComponent(ChatOverflowMenuComponent);
  fixture.componentRef.setInput('open', opts.open ?? true);
  if (opts.items !== undefined) fixture.componentRef.setInput('items', opts.items);
  fixture.detectChanges();
  return fixture;
}

describe('ChatOverflowMenuComponent', () => {
  it('renders nothing when open is false', () => {
    const fixture = render({ open: false, items: [{ id: 'a', label: 'A' }] });
    expect(fixture.nativeElement.querySelector('.chat-overflow-menu')).toBeNull();
  });

  it('renders items list when open is true', () => {
    const fixture = render({
      items: [
        { id: 'rename', label: 'Rename' },
        { id: 'delete', label: 'Delete', tone: 'destructive' },
      ],
    });
    const items = fixture.nativeElement.querySelectorAll('.chat-overflow-menu__item');
    expect(items.length).toBe(2);
    expect(items[0].textContent.trim()).toBe('Rename');
    expect(items[1].textContent.trim()).toBe('Delete');
  });

  it('applies destructive class to destructive-tone items', () => {
    const fixture = render({ items: [{ id: 'd', label: 'D', tone: 'destructive' }] });
    const item = fixture.nativeElement.querySelector('.chat-overflow-menu__item');
    expect(item.classList.contains('chat-overflow-menu__item--destructive')).toBe(true);
  });

  it('applies disabled class and aria-disabled to disabled items', () => {
    const fixture = render({ items: [{ id: 'x', label: 'X', disabled: true }] });
    const item = fixture.nativeElement.querySelector('.chat-overflow-menu__item');
    expect(item.classList.contains('chat-overflow-menu__item--disabled')).toBe(true);
    expect(item.getAttribute('aria-disabled')).toBe('true');
  });

  it('item click emits itemSelected and closed', () => {
    const fixture = render({ items: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] });
    let selected: string | undefined;
    let closes = 0;
    fixture.componentInstance.itemSelected.subscribe((id: string) => { selected = id; });
    fixture.componentInstance.closed.subscribe(() => { closes++; });
    const items = fixture.nativeElement.querySelectorAll('.chat-overflow-menu__item');
    (items[1] as HTMLElement).click();
    expect(selected).toBe('b');
    expect(closes).toBe(1);
  });

  it('disabled item click is a no-op', () => {
    const fixture = render({ items: [{ id: 'x', label: 'X', disabled: true }] });
    let emits = 0;
    fixture.componentInstance.itemSelected.subscribe(() => { emits++; });
    fixture.componentInstance.closed.subscribe(() => { emits++; });
    (fixture.nativeElement.querySelector('.chat-overflow-menu__item') as HTMLElement).click();
    expect(emits).toBe(0);
  });

  it('scrim click emits closed', () => {
    const fixture = render({ items: [{ id: 'a', label: 'A' }] });
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => { closes++; });
    (fixture.nativeElement.querySelector('.chat-overflow-menu__scrim') as HTMLElement).click();
    expect(closes).toBe(1);
  });

  it('Esc on the menu emits closed', () => {
    const fixture = render({ items: [{ id: 'a', label: 'A' }] });
    let closes = 0;
    fixture.componentInstance.closed.subscribe(() => { closes++; });
    const menu = fixture.nativeElement.querySelector('.chat-overflow-menu');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(closes).toBe(1);
  });
});
