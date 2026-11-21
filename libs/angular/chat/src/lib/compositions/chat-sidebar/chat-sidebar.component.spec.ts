// libs/angular/chat/src/lib/compositions/chat-sidebar/chat-sidebar.component.spec.ts
import { describe, it, expect, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Component, EnvironmentInjector, createEnvironmentInjector, input, output, runInInjectionContext } from '@angular/core';
import { By } from '@angular/platform-browser';
import type { Agent } from '../../agent';
import { mockAgent } from '../../testing/mock-agent';
import { ChatInterruptTemplateDirective } from '../chat/chat-interrupt-template.directive';
import { ChatComponent } from '../chat/chat.component';
import { ChatSidebarComponent } from './chat-sidebar.component';

@Component({
  selector: 'chat',
  standalone: true,
  template: '<ng-content />',
})
class SidebarTestChatComponent {
  readonly agent = input<unknown>();
  readonly views = input<unknown>();
  readonly clientTools = input<unknown>();
  readonly modelOptions = input<unknown>();
  readonly showModelPicker = input<unknown>();
  readonly selectedModel = input<unknown>();
  readonly rate = output<{ messageIndex: number; rating: 'up' | 'down' }>();
  readonly regenerate = output<void>();
  readonly messageCopy = output<{ messageIndex: number; content: string }>();
  readonly selectedModelChange = output<string>();
}

function createSidebarFixture() {
  TestBed.configureTestingModule({ imports: [ChatSidebarComponent] });
  TestBed.overrideComponent(ChatSidebarComponent, {
    remove: { imports: [ChatComponent] },
    add: { imports: [SidebarTestChatComponent] },
  });

  const fixture = TestBed.createComponent(ChatSidebarComponent);
  fixture.componentRef.setInput('agent', {} as Agent);
  fixture.detectChanges();

  return {
    fixture,
    innerChat: fixture.debugElement.query(By.directive(SidebarTestChatComponent))
      .componentInstance as SidebarTestChatComponent,
  };
}

describe('ChatSidebarComponent', () => {
  it('makes closed content inert and restores launcher focus without discarding drafts', () => {
    const { fixture } = createSidebarFixture();
    const host = fixture.nativeElement as HTMLElement;
    const panel = host.querySelector<HTMLElement>('.chat-sidebar__panel')!;
    const close = host.querySelector<HTMLButtonElement>('.chat-sidebar__close')!;
    const launcher = host.querySelector<HTMLButtonElement>('.chat-sidebar__launcher button')!;
    const draft = document.createElement('textarea');
    draft.value = 'Keep this draft';
    panel.append(draft);
    expect(panel.hasAttribute('inert')).toBe(true);
    fixture.componentInstance.openWindow();
    fixture.detectChanges();
    expect(document.activeElement).toBe(close);
    draft.focus();
    fixture.componentInstance.closeWindow();
    fixture.detectChanges();
    expect(document.activeElement).toBe(launcher);
    expect(panel.hasAttribute('inert')).toBe(true);
    expect(draft.value).toBe('Keep this draft');
  });

  it('keeps its panel sized to the keyboard viewport and follows Safari pan', () => {
    const previous = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    const viewport = Object.assign(new EventTarget(), { height: 714, offsetTop: 0, scale: 1 });
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    try {
      const { fixture } = createSidebarFixture();
      const host = fixture.nativeElement as HTMLElement;
      viewport.height = 377;
      viewport.offsetTop = 309;
      viewport.dispatchEvent(new Event('resize'));
      expect(host.style.getPropertyValue('--tplane-chat-viewport-height')).toBe('377px');
      expect(host.style.getPropertyValue('--tplane-chat-viewport-top')).toBe('309px');
      fixture.destroy();
    } finally {
      if (previous) Object.defineProperty(window, 'visualViewport', previous);
      else Reflect.deleteProperty(window, 'visualViewport');
    }
  });

  it('class is defined and imports resolve', () => {
    expect(ChatSidebarComponent).toBeDefined();
    expect(typeof ChatSidebarComponent).toBe('function');
  });

  it('toggle/openWindow/closeWindow flip the open model', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const sidebar = new ChatSidebarComponent();
      expect(sidebar.open()).toBe(false);
      sidebar.toggle();
      expect(sidebar.open()).toBe(true);
      sidebar.toggle();
      expect(sidebar.open()).toBe(false);
      sidebar.openWindow();
      expect(sidebar.open()).toBe(true);
      sidebar.closeWindow();
      expect(sidebar.open()).toBe(false);
    });
  });

  it('forwards rate events from the inner chat unchanged', () => {
    const { fixture, innerChat } = createSidebarFixture();
    const rateEvents: Array<{ messageIndex: number; rating: 'up' | 'down' }> = [];
    fixture.componentInstance.rate.subscribe((event) => rateEvents.push(event));

    innerChat.rate.emit({ messageIndex: 2, rating: 'down' });

    expect(rateEvents).toEqual([{ messageIndex: 2, rating: 'down' }]);
  });

  it('forwards regenerate events from the inner chat', () => {
    const { fixture, innerChat } = createSidebarFixture();
    let regenerateCount = 0;
    fixture.componentInstance.regenerate.subscribe(() => regenerateCount++);

    innerChat.regenerate.emit();

    expect(regenerateCount).toBe(1);
  });

  it('forwards message copy events from the inner chat unchanged', () => {
    const { fixture, innerChat } = createSidebarFixture();
    const copyEvents: Array<{ messageIndex: number; content: string }> = [];
    fixture.componentInstance.messageCopy.subscribe((event) => copyEvents.push(event));
    const event = { messageIndex: 3, content: 'copied text' };

    innerChat.messageCopy.emit(event);

    expect(copyEvents).toEqual([event]);
  });
});

describe('ChatSidebarComponent — edge-claim attribute', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-threadplane-chat-sidebar');
  });

  it('sets data-threadplane-chat-sidebar="open" on <html> while open', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const sidebar = new ChatSidebarComponent();
      // Trigger the open-tracking effect by setting open=true
      sidebar.openWindow();
      // Force a microtask flush so the effect runs
      TestBed.flushEffects();
      expect(document.documentElement.getAttribute('data-threadplane-chat-sidebar')).toBe('open');
    });
  });

  it('removes data-threadplane-chat-sidebar from <html> when closed', () => {
    TestBed.configureTestingModule({});
    TestBed.runInInjectionContext(() => {
      const sidebar = new ChatSidebarComponent();
      sidebar.openWindow();
      TestBed.flushEffects();
      sidebar.closeWindow();
      TestBed.flushEffects();
      expect(document.documentElement.hasAttribute('data-threadplane-chat-sidebar')).toBe(false);
    });
  });

  it('removes the <html> claim when the sidebar is DESTROYED while open', () => {
    // Regression: unmounting an open sidebar (e.g. switching demo modes) must
    // not leave data-threadplane-chat-sidebar="open" stuck on <html>, or peer
    // panels keep reserving --tplane-chat-occupy-right and a phantom gap persists.
    TestBed.configureTestingModule({});
    const parent = TestBed.inject(EnvironmentInjector);
    const child = createEnvironmentInjector([], parent);
    let sidebar!: ChatSidebarComponent;
    runInInjectionContext(child, () => {
      sidebar = new ChatSidebarComponent();
    });
    sidebar.openWindow();
    TestBed.flushEffects();
    expect(document.documentElement.getAttribute('data-threadplane-chat-sidebar')).toBe('open');
    // Destroy the injector that owns the component's effects (simulates unmount).
    child.destroy();
    expect(document.documentElement.hasAttribute('data-threadplane-chat-sidebar')).toBe(false);
  });

  it('flex layout: host is a flex row with threaded height (no hardcoded 100vh content)', () => {
    // Angular rewrites :host → [_nghost-%COMP%] and appends [_ngcontent-%COMP%]
    // to class selectors, so match those forms (see the panel/launcher tests).
    const styles = (ChatSidebarComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    // Host is a flex row (the only host block carrying display:flex).
    expect(styles).toMatch(/\[_nghost-%COMP%\][^{]*\{[^}]*display:\s*flex/);
    // The content slot fills via flex (not a hardcoded viewport height).
    expect(styles).toMatch(/\.chat-sidebar__content[^{]*\{[^}]*flex:\s*1\s+1\s+auto/);
    expect(styles).not.toMatch(/min-height:\s*100vh/);
  });

  it('panel CSS reads PEER --tplane-chat-debug-claim-bottom (not aggregate)', () => {
    // Components must read PEER per-component claim vars, never the
    // aggregate occupy-* (which they write to themselves). The aggregate
    // is for external consumer convenience; internal panels read
    // peer-specific to avoid self-feedback.
    const styles = (ChatSidebarComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(styles).toMatch(/\.chat-sidebar__panel[^{]*\{[^}]*height:[^;]*var\(--tplane-chat-debug-claim-bottom/);
  });

  it('launcher CSS reads PEER --tplane-chat-debug-claim-bottom (not aggregate)', () => {
    const styles = (ChatSidebarComponent as unknown as { ɵcmp: { styles: string[] } }).ɵcmp.styles.join('\n');
    expect(styles).toMatch(/\.chat-sidebar__launcher[^{]*\{[^}]*bottom:\s*calc\(1rem\s*\+\s*var\(--tplane-chat-debug-claim-bottom/);
  });
});

@Component({
  standalone: true,
  imports: [ChatSidebarComponent, ChatInterruptTemplateDirective],
  template: `
    <chat-sidebar [agent]="agent" [open]="true">
      <ng-template chatInterruptTemplate let-ctxAgent let-interrupt="interrupt" let-interrupts="interrupts">
        <div
          class="interrupt-card"
          [attr.data-interrupt]="interrupt.id"
          [attr.data-batch]="ids(interrupts)"
          [attr.data-same-agent]="ctxAgent === agent"
        ></div>
      </ng-template>
    </chat-sidebar>
  `,
})
class InterruptTemplateHost {
  agent = mockAgent({ messages: [{ id: 'u1', role: 'user', content: 'Refund both' }] });
  ids(interrupts: readonly { id: string }[]): string {
    return interrupts.map((entry) => entry.id).join(',');
  }
}

describe('ChatSidebarComponent — projected chatInterruptTemplate', () => {
  it('forwards the agent, the first interrupt and the whole pending batch to the inner chat', () => {
    TestBed.configureTestingModule({ imports: [InterruptTemplateHost] });
    const fixture = TestBed.createComponent(InterruptTemplateHost);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelector('.interrupt-card')).toBeNull();

    fixture.componentInstance.agent.interrupts.set([
      { id: 'approve-1', value: {} },
      { id: 'approve-2', value: {} },
    ]);
    fixture.detectChanges();
    const card = root.querySelector<HTMLElement>('.chat-interrupt-region .interrupt-card');
    expect(card).not.toBeNull();
    expect(card?.dataset['interrupt']).toBe('approve-1');
    expect(card?.dataset['batch']).toBe('approve-1,approve-2');
    expect(card?.dataset['sameAgent']).toBe('true');

    fixture.componentInstance.agent.interrupts.set([{ id: 'approve-2', value: {} }]);
    fixture.detectChanges();
    const next = root.querySelector<HTMLElement>('.interrupt-card');
    expect(next?.dataset['interrupt']).toBe('approve-2');
    expect(next?.dataset['batch']).toBe('approve-2');

    fixture.componentInstance.agent.interrupts.set([]);
    fixture.detectChanges();
    expect(root.querySelector('.interrupt-card')).toBeNull();
    fixture.destroy();
  });
});
