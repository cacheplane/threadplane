import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AgUiShell } from './ag-ui-shell.component';
import { ITINERARY_AGENT } from '../client-tools';
import { ItineraryStore } from '../itinerary-store';
import { FakeAgent, toAgent } from '@threadplane/ag-ui';
import { signal } from '@angular/core';
import type { InterruptAction } from '@threadplane/chat';

const KEY = 'threadplane-ag-ui-demo:palette';
function setup(query = '') {
  window.history.replaceState({}, '', `/embed${query}`);
  const adapter = toAgent(new FakeAgent({ delayMs: 0 }));
  const submit = vi.fn().mockResolvedValue(undefined);
  const agent = { ...adapter, submit, interrupt: signal({ value: { reason: 'Delete old backups' } }) };
  TestBed.configureTestingModule({ providers: [
    provideRouter([{ path: 'embed', children: [] }]), ItineraryStore,
    { provide: ITINERARY_AGENT.token, useValue: agent },
  ] });
  const fixture = TestBed.createComponent(AgUiShell);
  // Router outlet navigation is irrelevant to these shell controls.
  fixture.detectChanges();
  return { fixture, shell: fixture.componentInstance, submit, adapter };
}

beforeEach(() => { localStorage.clear(); });
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('AG-UI shell theme preferences', () => {
  it.each([
    ['theme=default-light', 'default-light', 'light'],
    ['theme=default-dark', 'default-dark', 'dark'],
    ['scheme=light', 'default-light', 'light'],
    ['theme=default-light&scheme=dark', 'default-dark', 'dark'],
    ['theme=material-light', 'material-light', 'dark'],
  ])('hydrates %s without changing saved preferences', (query, theme, scheme) => {
    const stored = JSON.stringify({ theme: 'default-dark', colorScheme: 'dark' });
    localStorage.setItem(KEY, stored);
    const { shell } = setup(`?${query}`);
    expect(shell.theme()).toBe(theme);
    expect(shell.colorScheme()).toBe(scheme);
    expect(localStorage.getItem(KEY)).toBe(stored);
  });

  it('pairs and persists a user-selected default theme and scheme', () => {
    const { shell, fixture } = setup();
    (shell as unknown as { onThemeChange(v: string): void }).onThemeChange('default-light');
    fixture.detectChanges();
    expect(shell.theme()).toBe('default-light');
    expect(shell.colorScheme()).toBe('light');
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ theme: 'default-light', colorScheme: 'light' });
  });

  it('persists the paired default preset when the scheme is toggled', () => {
    const { fixture } = setup();
    fixture.nativeElement.querySelector('.ag-ui-shell__theme-toggle').click();
    fixture.detectChanges();
    expect(JSON.parse(localStorage.getItem(KEY) ?? '{}')).toMatchObject({ theme: 'default-light', colorScheme: 'light' });
  });

  it('keeps a Material preset independent of the page scheme', () => {
    const { shell, fixture } = setup('?theme=material-dark');
    fixture.nativeElement.querySelector('.ag-ui-shell__theme-toggle').click();
    fixture.detectChanges();
    expect(shell.theme()).toBe('material-dark');
    expect(shell.colorScheme()).toBe('light');
  });
});

describe('AG-UI shell mobile controls', () => {
  it('discloses settings and updates the inline model picker at the mobile breakpoint', () => {
    const { fixture, shell } = setup();
    const button = fixture.nativeElement.querySelector('[aria-label="Demo settings"]') as HTMLButtonElement;
    expect(button).toBeTruthy();
    expect(button.getAttribute('aria-expanded')).toBe('false');
    button.click(); fixture.detectChanges();
    expect(button.getAttribute('aria-expanded')).toBe('true');
    vi.stubGlobal('innerWidth', 375);
    window.dispatchEvent(new Event('resize')); fixture.detectChanges();
    expect((shell as unknown as { showInlineModelPicker(): boolean }).showInlineModelPicker()).toBe(false);
  });
});

describe('AG-UI shell approval submissions', () => {
  it.each<[InterruptAction, string]>([['accept', 'approved'], ['ignore', 'denied'], ['edit', 'Only archive'], ['respond', 'Please explain']])(
    '%s submits its resume value through the palette state wrapper', async (action, resume) => {
      const { shell, submit } = setup('?model=gpt-5-nano&effort=high&genui=json-render');
      vi.spyOn(window, 'prompt').mockReturnValue(resume);
      await (shell as unknown as { onInterruptAction(a: InterruptAction): Promise<void> }).onInterruptAction(action);
      expect(submit).toHaveBeenCalledExactlyOnceWith({ resume, state: { model: 'gpt-5-nano', reasoning_effort: 'high', gen_ui_mode: 'json-render' } }, undefined);
    },
  );
  it.each<InterruptAction>(['edit', 'respond'])('canceling %s does not submit', async action => {
    const { shell, submit } = setup();
    vi.spyOn(window, 'prompt').mockReturnValue(null);
    await (shell as unknown as { onInterruptAction(a: InterruptAction): Promise<void> }).onInterruptAction(action);
    expect(submit).not.toHaveBeenCalled();
  });

  it('leaves approvals inside their chat surface instead of adding a shell overlay', () => {
    const { fixture } = setup();
    expect(fixture.nativeElement.querySelector('chat-interrupt-panel')).toBeNull();
  });
});
