// libs/chat/src/lib/primitives/chat-project-list/chat-project-list.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatProjectListComponent,
  type Project,
  type ProjectActionAdapter,
} from './chat-project-list.component';

function render(opts: {
  projects?: Project[];
  actions?: ProjectActionAdapter | null;
  activeProjectId?: string | null;
  showNewProjectButton?: boolean;
} = {}) {
  const fixture = TestBed.createComponent(ChatProjectListComponent);
  fixture.componentRef.setInput('projects', opts.projects ?? [{ id: 'p1', name: 'Work' }, { id: 'p2', name: 'Personal' }]);
  if (opts.actions !== undefined) fixture.componentRef.setInput('actions', opts.actions);
  if (opts.activeProjectId !== undefined) fixture.componentRef.setInput('activeProjectId', opts.activeProjectId);
  if (opts.showNewProjectButton !== undefined) fixture.componentRef.setInput('showNewProjectButton', opts.showNewProjectButton);
  fixture.detectChanges();
  return fixture;
}

describe('ChatProjectListComponent', () => {
  it('renders the project rows', () => {
    const fixture = render();
    const items = fixture.nativeElement.querySelectorAll('.chat-project-list__item');
    expect(items.length).toBe(2);
    expect((items[0] as HTMLElement).textContent?.trim()).toBe('Work');
  });

  it('clicking a row emits projectSelected', () => {
    const fixture = render();
    let received: string | undefined;
    fixture.componentInstance.projectSelected.subscribe((id: string) => { received = id; });
    const items = fixture.nativeElement.querySelectorAll('.chat-project-list__item');
    (items[1] as HTMLElement).click();
    expect(received).toBe('p2');
  });

  it('activeProjectId match adds data-active', () => {
    const fixture = render({ activeProjectId: 'p1' });
    const items = fixture.nativeElement.querySelectorAll('.chat-project-list__item');
    expect((items[0] as HTMLElement).getAttribute('data-active')).toBe('true');
    expect((items[1] as HTMLElement).getAttribute('data-active')).toBeNull();
  });

  it('showNewProjectButton=false hides + New project', () => {
    const fixture = render({ showNewProjectButton: false });
    expect(fixture.nativeElement.querySelector('.chat-project-list__new')).toBeNull();
  });

  it('clicking + New project emits newProjectRequested and shows inline input', async () => {
    const fixture = render({
      showNewProjectButton: true,
      actions: { create: vi.fn().mockResolvedValue({ id: 'new' }) },
    });
    let emits = 0;
    fixture.componentInstance.newProjectRequested.subscribe(() => { emits++; });
    (fixture.nativeElement.querySelector('.chat-project-list__new') as HTMLElement).click();
    fixture.detectChanges();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    fixture.detectChanges();
    expect(emits).toBe(1);
    const input = fixture.nativeElement.querySelector('.chat-project-list__edit') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.getAttribute('placeholder')).toBe('New project name');
  });

  it('Enter on new-project input calls adapter.create', async () => {
    const createSpy = vi.fn().mockResolvedValue({ id: 'new' });
    const fixture = render({ showNewProjectButton: true, actions: { create: createSpy } });
    (fixture.nativeElement.querySelector('.chat-project-list__new') as HTMLElement).click();
    fixture.detectChanges();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.chat-project-list__edit') as HTMLInputElement;
    input.value = 'Hobbies';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(createSpy).toHaveBeenCalledWith('Hobbies');
  });

  it('Esc on new-project input cancels without calling adapter', async () => {
    const createSpy = vi.fn().mockResolvedValue({ id: 'new' });
    const fixture = render({ showNewProjectButton: true, actions: { create: createSpy } });
    (fixture.nativeElement.querySelector('.chat-project-list__new') as HTMLElement).click();
    fixture.detectChanges();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.chat-project-list__edit') as HTMLInputElement;
    input.value = 'X';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(createSpy).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('.chat-project-list__edit')).toBeNull();
  });

  it('Rename via kebab opens edit mode with prefilled name', async () => {
    const fixture = render({ actions: { rename: vi.fn().mockResolvedValue(undefined) } });
    (fixture.nativeElement.querySelector('.chat-project-list__kebab') as HTMLElement).click();
    fixture.detectChanges();
    const item = Array.from(document.querySelectorAll('.chat-overflow-menu__item'))
      .find((el) => (el as HTMLElement).textContent?.trim() === 'Rename') as HTMLElement;
    item.click();
    fixture.detectChanges();
    await new Promise((r) => queueMicrotask(() => r(undefined)));
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('.chat-project-list__edit') as HTMLInputElement;
    expect(input.value).toBe('Work');
  });

  it('Delete via kebab opens confirm dialog (destructive); confirm calls adapter', async () => {
    let resolveDelete!: () => void;
    const deleteSpy = vi.fn(() => new Promise<void>((r) => { resolveDelete = r; }));
    const fixture = render({ actions: { delete: deleteSpy } });
    (fixture.nativeElement.querySelector('.chat-project-list__kebab') as HTMLElement).click();
    fixture.detectChanges();
    const item = Array.from(document.querySelectorAll('.chat-overflow-menu__item'))
      .find((el) => (el as HTMLElement).textContent?.trim() === 'Delete') as HTMLElement;
    item.click();
    fixture.detectChanges();
    expect(document.querySelector('.chat-confirm-dialog')).not.toBeNull();
    (document.querySelector('.chat-confirm-dialog__confirm') as HTMLElement).click();
    fixture.detectChanges();
    expect(deleteSpy).toHaveBeenCalledWith('p1');
    const remaining = fixture.nativeElement.querySelectorAll('.chat-project-list__item');
    expect(remaining.length).toBe(1);
    resolveDelete();
    await new Promise((r) => setTimeout(r, 0));
  });

  it('Delete adapter rejects → row reappears', async () => {
    const deleteSpy = vi.fn(async () => { throw new Error('boom'); });
    const fixture = render({ actions: { delete: deleteSpy } });
    (fixture.nativeElement.querySelector('.chat-project-list__kebab') as HTMLElement).click();
    fixture.detectChanges();
    const item = Array.from(document.querySelectorAll('.chat-overflow-menu__item'))
      .find((el) => (el as HTMLElement).textContent?.trim() === 'Delete') as HTMLElement;
    item.click();
    fixture.detectChanges();
    (document.querySelector('.chat-confirm-dialog__confirm') as HTMLElement).click();
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    fixture.detectChanges();
    const remaining = fixture.nativeElement.querySelectorAll('.chat-project-list__item');
    expect(remaining.length).toBe(2);
  });
});

describe('ChatProjectListComponent — New project secondary pill', () => {
  it('renders the new-project button with borderless surface-alt pill styling', () => {
    const styles = (ChatProjectListComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(styles).toMatch(/\.chat-project-list__new[^{]*\{[^}]*background:\s*var\(--tplane-chat-surface-alt/);
    expect(styles).toMatch(/\.chat-project-list__new[^{]*\{[^}]*border-radius:\s*var\(--tplane-chat-radius-button\)/);
    expect(styles).toMatch(/\.chat-project-list__new[^{]*\{[^}]*border:\s*0/);
  });
});
