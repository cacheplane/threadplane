// libs/angular/chat/threads/src/chat-confirm-dialog.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ChatConfirmDialogComponent } from './chat-confirm-dialog.component';
import { CHAT_CONFIRM_DIALOG_STYLES } from './chat-confirm-dialog.styles';

function render(opts: {
  open?: boolean;
  title?: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'destructive' | 'normal';
} = {}) {
  const fixture = TestBed.createComponent(ChatConfirmDialogComponent);
  fixture.componentRef.setInput('open', opts.open ?? true);
  if (opts.title !== undefined) fixture.componentRef.setInput('title', opts.title);
  if (opts.body !== undefined) fixture.componentRef.setInput('body', opts.body);
  if (opts.confirmLabel !== undefined) fixture.componentRef.setInput('confirmLabel', opts.confirmLabel);
  if (opts.cancelLabel !== undefined) fixture.componentRef.setInput('cancelLabel', opts.cancelLabel);
  if (opts.tone !== undefined) fixture.componentRef.setInput('tone', opts.tone);
  fixture.detectChanges();
  return fixture;
}

describe('ChatConfirmDialogComponent', () => {
  it('renders nothing when open is false', () => {
    const fixture = render({ open: false });
    expect(fixture.nativeElement.querySelector('.chat-confirm-dialog')).toBeNull();
  });

  it('renders title and body when provided', () => {
    const fixture = render({ title: 'Delete?', body: 'This cannot be undone.' });
    expect(fixture.nativeElement.querySelector('.chat-confirm-dialog__title').textContent.trim()).toBe('Delete?');
    expect(fixture.nativeElement.querySelector('.chat-confirm-dialog__body').textContent.trim()).toBe('This cannot be undone.');
  });

  it('omits body element when body is empty', () => {
    const fixture = render({ title: 'T', body: '' });
    expect(fixture.nativeElement.querySelector('.chat-confirm-dialog__body')).toBeNull();
    const dialog = fixture.nativeElement.querySelector('.chat-confirm-dialog');
    expect(dialog.getAttribute('aria-describedby')).toBeNull();
  });

  it('aria-labelledby points at the title element id', () => {
    const fixture = render({ title: 'T' });
    const dialog = fixture.nativeElement.querySelector('.chat-confirm-dialog');
    const labelId = dialog.getAttribute('aria-labelledby');
    expect(labelId).toBeTruthy();
    expect(fixture.nativeElement.querySelector(`#${labelId}`).textContent.trim()).toBe('T');
  });

  it('confirm button click emits confirmed', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.confirmed.subscribe(() => { emits++; });
    (fixture.nativeElement.querySelector('.chat-confirm-dialog__confirm') as HTMLElement).click();
    expect(emits).toBe(1);
  });

  it('cancel button click emits cancelled', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.cancelled.subscribe(() => { emits++; });
    (fixture.nativeElement.querySelector('.chat-confirm-dialog__cancel') as HTMLElement).click();
    expect(emits).toBe(1);
  });

  it('scrim click emits cancelled', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.cancelled.subscribe(() => { emits++; });
    (fixture.nativeElement.querySelector('.chat-confirm-dialog__scrim') as HTMLElement).click();
    expect(emits).toBe(1);
  });

  it('Esc on the dialog emits cancelled', () => {
    const fixture = render();
    let emits = 0;
    fixture.componentInstance.cancelled.subscribe(() => { emits++; });
    const dialog = fixture.nativeElement.querySelector('.chat-confirm-dialog');
    dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(emits).toBe(1);
  });

  it('destructive tone applies destructive class to confirm button', () => {
    const fixture = render({ tone: 'destructive' });
    const confirm = fixture.nativeElement.querySelector('.chat-confirm-dialog__confirm');
    expect(confirm.classList.contains('chat-confirm-dialog__confirm--destructive')).toBe(true);
  });

  it('destructive confirm button uses the new --tplane-chat-destructive token, not --tplane-chat-error-text', () => {
    // Regression guard: error-text is light pink (#fca5a5) in dark mode, which gave
    // white-text-on-pink unreadable contrast. The destructive button must use a
    // dedicated token that resolves to a saturated red on both themes.
    expect(CHAT_CONFIRM_DIALOG_STYLES).toContain('.chat-confirm-dialog__confirm--destructive');
    const destructiveBlock = CHAT_CONFIRM_DIALOG_STYLES
      .split('.chat-confirm-dialog__confirm--destructive')
      .slice(1)
      .join('.chat-confirm-dialog__confirm--destructive');
    expect(destructiveBlock).toContain('var(--tplane-chat-destructive)');
    expect(destructiveBlock).not.toContain('var(--tplane-chat-error-text)');
  });

  it('confirm button has labelled text from confirmLabel input', () => {
    const fixture = render({ confirmLabel: 'Yes do it' });
    const confirm = fixture.nativeElement.querySelector('.chat-confirm-dialog__confirm');
    expect(confirm.textContent.trim()).toBe('Yes do it');
  });
});
