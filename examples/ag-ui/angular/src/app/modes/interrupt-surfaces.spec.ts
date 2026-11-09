import { afterEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { FakeAgent, toAgent } from '@threadplane/ag-ui';
import { staticDelivery, type Message } from '@threadplane/chat';
import { AgUiShell } from '../shell/ag-ui-shell.component';
import { EmbedMode } from './embed-mode.component';
import { PopupMode } from './popup-mode.component';
import { SidebarMode } from './sidebar-mode.component';

afterEach(() => vi.restoreAllMocks());

describe.each([['embed', EmbedMode], ['popup', PopupMode], ['sidebar', SidebarMode]] as const)('%s approval surface', (_name, Mode) => {
  it('renders exactly one approval inside chat and forwards its action', () => {
    const adapter = toAgent(new FakeAgent());
    // Seed a paused conversation synchronously. HTTP/resume behavior is
    // covered by approval-surfaces.spec.ts; this test checks projection.
    const agent = {
      ...adapter,
      messages: signal<Message[]>([{
        id: 'review', role: 'user', content: 'Review backup deletion', delivery: staticDelivery('review'),
      }]),
      interrupt: signal({ value: { reason: 'Review backup deletion' } }),
    };
    const onInterruptAction = vi.fn();
    TestBed.configureTestingModule({ providers: [{ provide: AgUiShell, useValue: {
      agent, clientTools: undefined, modelOptions: signal([]), model: signal('gpt-5-mini'),
      appMode: signal('off'), showInlineModelPicker: signal(false), hasMapsKey: false,
      onInterruptAction,
    } }] });
    const fixture = TestBed.createComponent<unknown>(Mode);
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const panel = el.querySelector('chat chat-interrupt-panel');
    expect(panel).toBeTruthy();
    expect(el.querySelectorAll('chat-interrupt-panel')).toHaveLength(1);
    expect(panel?.textContent).toContain('Review backup deletion');
    (panel?.querySelector('button') as HTMLButtonElement).click();
    expect(onInterruptAction).toHaveBeenCalledExactlyOnceWith('accept');
    adapter.dispose();
  });
});
