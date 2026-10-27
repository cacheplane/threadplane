import { signal } from '@angular/core';
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, NavigationEnd } from '@angular/router';
import {
  LangGraphThreadsAdapter,
  LANGGRAPH_THREADS_CONFIG,
  provideAgent,
  FakeStreamTransport,
  type AgentTransport,
} from '@threadplane/langgraph';
import { DemoShell, shouldSyncCheckpoint, extractItinerary, isConflict } from './demo-shell.component';
import { DEMO_AGENT_REF } from './agent-ref';
import { ItineraryStore, type ItineraryStop } from '../itinerary-store';

function createThreadsAdapterMock() {
  const threads = signal([]);
  const archivedThreads = signal([]);
  return {
    threads: threads.asReadonly(),
    archivedThreads: archivedThreads.asReadonly(),
    refresh: async () => undefined,
    getThread: async () => null,
    create: async () => 'new-thread',
    delete: async () => undefined,
    rename: async () => undefined,
    archive: async () => undefined,
    unarchive: async () => undefined,
    pin: async () => undefined,
    unpin: async () => undefined,
    moveToProject: async () => undefined,
    reorderPinned: async () => undefined,
  };
}

const threadsAdapterProvider = {
  provide: LangGraphThreadsAdapter,
  useFactory: createThreadsAdapterMock,
};

describe('DemoShell — mode signal', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: 'popup', component: DemoShell },
          { path: 'sidebar', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('defaults to "embed" when URL is /', async () => {
    const fixture = TestBed.createComponent(DemoShell);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as { mode: () => string };
    expect(cmp.mode()).toBe('embed');
  });

  it('resolves "popup" when navigating to /popup', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/popup');
    const fixture = TestBed.createComponent(DemoShell);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as { mode: () => string };
    expect(cmp.mode()).toBe('popup');
  });

  it('falls back to "embed" for unknown segments', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/bogus');
    const fixture = TestBed.createComponent(DemoShell);
    fixture.detectChanges();
    const cmp = fixture.componentInstance as unknown as { mode: () => string };
    expect(cmp.mode()).toBe('embed');
  });
});

describe('DemoShell — toolbar layout', () => {
  it('no longer renders the "New conversation" button (removed for tightness)', () => {
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('.demo-shell__toolbar-action')).toBeNull();
  });

  it('renders fields without visible per-field labels (tighter toolbar)', () => {
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    const fields = fx.nativeElement.querySelectorAll('.demo-shell__field');
    expect(fields.length).toBe(4);
    for (const field of Array.from(fields) as HTMLElement[]) {
      // No <span> sibling labels remain inside fields.
      expect(field.querySelector(':scope > span')).toBeNull();
    }
  });
});

describe('DemoShell — toolbar dropdowns use chat-select', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('renders the four toolbar fields with <chat-select>, not native <select>', () => {
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    const fields = fx.nativeElement.querySelectorAll('.demo-shell__field');
    expect(fields.length).toBe(4);
    for (const field of Array.from(fields) as HTMLElement[]) {
      expect(field.querySelector('chat-select')).toBeTruthy();
      expect(field.querySelector('select')).toBeNull();
    }
  });
});

describe('DemoShell — URL thread sync', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: 'embed/:threadId', component: DemoShell },
          { path: 'popup', component: DemoShell },
          { path: 'popup/:threadId', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('does not clear an agent-created thread id while URL navigation is still pending', () => {
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { (): string | null; set(value: string | null): void };
    };

    expect(cmp.threadIdSignal()).toBeNull();
    cmp.threadIdSignal.set('thread-created-by-agent');
    fx.detectChanges();

    expect(cmp.threadIdSignal()).toBe('thread-created-by-agent');
  });

  it('does not write the active thread id to localStorage (URL is the source of truth)', () => {
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { set(value: string | null): void };
    };

    cmp.threadIdSignal.set('thread-created-by-agent');
    fx.detectChanges();

    const raw = localStorage.getItem('threadplane-chat-demo:palette');
    const stored = raw ? JSON.parse(raw) : {};
    expect(stored.threadId).toBeUndefined();
  });

  it('ignores any legacy persisted threadId — bare mode URLs start fresh', async () => {
    localStorage.setItem(
      'threadplane-chat-demo:palette',
      JSON.stringify({ threadId: 'legacy-persisted-thread' }),
    );
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/popup');

    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { (): string | null };
    };
    expect(cmp.threadIdSignal()).toBeNull();
  });

  it('hydrates the active thread id from /<mode>/<threadId> URLs', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed/url-thread');

    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { (): string | null };
    };
    expect(cmp.threadIdSignal()).toBe('url-thread');
  });

  it('does not re-navigate when hydrating from URL (no nav-loop)', async () => {
    // Regression guard for the URL↔signal sync invariant that every PR
    // in the routing chain (#500/#504/#514/#518/#527) was dancing
    // around: when the URL→signal effect hydrates `threadIdSignal`
    // from `/embed/<id>`, the subsequent signal→URL effect must see
    // signal === urlId and short-circuit (compare-and-set guard).
    // Without that guard we'd loop: URL → signal → router.navigate →
    // URL again, observable as extra NavigationEnd events.
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed/no-loop-thread');

    // Subscribe BEFORE createComponent so we capture any NavigationEnd
    // events the component's effects might emit. The initial nav above
    // already fired before we subscribed, so it doesn't count.
    const navEnds: string[] = [];
    const sub = router.events.subscribe((e) => {
      if (e instanceof NavigationEnd) navEnds.push(e.urlAfterRedirects);
    });

    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    sub.unsubscribe();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { (): string | null };
    };
    expect(cmp.threadIdSignal()).toBe('no-loop-thread');
    // Zero NavigationEnd events — the signal→URL effect short-circuited
    // because signal already matched urlState (compare-and-set guard).
    expect(navEnds).toEqual([]);
  });
});

describe('DemoShell — URL knob hydration', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: 'embed/:threadId', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('hydrates knob signals from URL query params', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed?model=gpt-5-nano&effort=high&theme=material-dark');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      model: () => string;
      effort: () => string;
      theme: () => string;
    };
    expect(cmp.model()).toBe('gpt-5-nano');
    expect(cmp.effort()).toBe('high');
    expect(cmp.theme()).toBe('material-dark');
  });

  it('does NOT write to localStorage when hydrating from URL (ephemeral semantics)', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed?theme=material-dark');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const raw = localStorage.getItem('threadplane-chat-demo:palette');
    const stored = raw ? JSON.parse(raw) : {};
    expect(stored.theme).toBeUndefined();
  });

  it('drops default knob values from URL on change-to-default', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed?model=gpt-5-nano');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      onModelChange(v: string): void;
    };
    cmp.onModelChange('gpt-5-mini'); // default
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(router.url).not.toContain('model=');
  });

  it('writes non-default knob values to URL on change', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      onModelChange(v: string): void;
    };
    cmp.onModelChange('gpt-5-nano');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(router.url).toContain('model=gpt-5-nano');
  });

  it('user knob action persists to localStorage (regression guard)', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      onThemeChange(v: string): void;
    };
    cmp.onThemeChange('material-dark');
    const raw = localStorage.getItem('threadplane-chat-demo:palette');
    const stored = raw ? JSON.parse(raw) : {};
    expect(stored.theme).toBe('material-dark');
  });

  it('preserves query params on mode change', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed?model=gpt-5-nano');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      onModeChange(next: string): void;
    };
    cmp.onModeChange('popup');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(router.url).toContain('model=gpt-5-nano');
  });

  it('preserves query params on thread switch (signal→URL effect)', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed?model=gpt-5-nano');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      threadIdSignal: { set(v: string | null): void };
    };
    cmp.threadIdSignal.set('xyz123');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(router.url).toContain('/embed/xyz123');
    expect(router.url).toContain('model=gpt-5-nano');
  });
});

describe('DemoShell — App mode routing', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: 'popup', component: DemoShell },
          { path: 'sidebar', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('coerces embed → sidebar when App mode turns on', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/embed');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      appMode: () => 'on' | 'off';
      onAppModeChange(v: 'on' | 'off'): void;
    };
    expect(cmp.appMode()).toBe('off');

    cmp.onAppModeChange('on');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(cmp.appMode()).toBe('on');
    expect(router.url).toContain('/sidebar');
  });

  it('turning App mode off keeps the current route', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/sidebar');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      appMode: { (): 'on' | 'off'; set(v: 'on' | 'off'): void };
      onAppModeChange(v: 'on' | 'off'): void;
    };
    cmp.appMode.set('on');
    fx.detectChanges();

    cmp.onAppModeChange('off');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(cmp.appMode()).toBe('off');
    expect(router.url).toContain('/sidebar');
    expect(router.url).not.toContain('/embed');
  });

  it('selecting embed while App mode on turns App mode off', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/sidebar');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      appMode: { (): 'on' | 'off'; set(v: 'on' | 'off'): void };
      onModeChange(next: string): void;
    };
    cmp.appMode.set('on');
    fx.detectChanges();

    cmp.onModeChange('embed');
    fx.detectChanges();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    expect(cmp.appMode()).toBe('off');
  });
});

describe('DemoShell — App-mode cockpit layout', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: 'popup', component: DemoShell },
          { path: 'sidebar', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('renders the map backdrop + itinerary overlay and forces drawer sidenav in popup App mode', async () => {
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/popup');
    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();

    const cmp = fx.componentInstance as unknown as {
      appMode: { (): 'on' | 'off'; set(v: 'on' | 'off'): void };
      sidenavMode: () => string;
    };

    cmp.appMode.set('on');
    fx.detectChanges();

    // App mode collapses the sidenav to its hamburger drawer.
    expect(cmp.sidenavMode()).toBe('drawer');

    // Popup App mode renders the full-bleed map backdrop + floating itinerary.
    const el = fx.nativeElement as HTMLElement;
    expect(el.querySelector('.demo-shell__app-body')).toBeTruthy();
    expect(el.querySelector('app-map-canvas')).toBeTruthy();
    expect(el.querySelector('app-itinerary-panel')).toBeTruthy();
  });
});

// ── Itinerary ↔ checkpoint sync (Task 9) ────────────────────────────────────

/** A FakeStreamTransport that records the payload of the most recent
 *  submit so a spec can assert the shell's state injection. */
class CapturingTransport extends FakeStreamTransport {
  lastPayload: unknown = undefined;
  override async *stream(
    assistantId: string,
    threadId: string | null,
    payload: unknown,
    signal: AbortSignal,
    options?: Parameters<AgentTransport['stream']>[4],
  ) {
    this.lastPayload = payload;
    yield* super.stream(assistantId, threadId, payload, signal, options);
  }
}

describe('shouldSyncCheckpoint — push-gate predicate', () => {
  it('pushes when a thread exists and content changed', () => {
    expect(shouldSyncCheckpoint('thread-1', '[1]', '[0]')).toBe(true);
  });

  it('never pushes without a thread id', () => {
    expect(shouldSyncCheckpoint(null, '[1]', '[0]')).toBe(false);
  });

  it('skips when the content already matches lastSynced (echo-loop guard)', () => {
    expect(shouldSyncCheckpoint('thread-1', '[1]', '[1]')).toBe(false);
  });
});

describe('isConflict — retry only the mid-run 409', () => {
  it('is true for a 409 status', () => {
    expect(isConflict({ status: 409 })).toBe(true);
  });

  it('is true when the message mentions 409/conflict', () => {
    expect(isConflict(new Error('Request failed: 409 Conflict'))).toBe(true);
  });

  it('is false for other errors (terminal — do not retry)', () => {
    expect(isConflict({ status: 404 })).toBe(false);
    expect(isConflict(new Error('Unauthorized'))).toBe(false);
    expect(isConflict(null)).toBe(false);
  });
});

describe('extractItinerary — value → stops', () => {
  it('returns the itinerary array from a state value', () => {
    const stops: ItineraryStop[] = [{ id: 'x', day: 1, place: 'Louvre' }];
    expect(extractItinerary({ itinerary: stops })).toEqual(stops);
  });

  it('returns null when no itinerary present', () => {
    expect(extractItinerary({ messages: [] })).toBeNull();
    expect(extractItinerary(undefined)).toBeNull();
    expect(extractItinerary({ itinerary: 'not-an-array' })).toBeNull();
  });
});

describe('DemoShell — submit injects itinerary into state', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        threadsAdapterProvider,
        ItineraryStore,
        { provide: LANGGRAPH_THREADS_CONFIG, useValue: { apiUrl: 'http://localhost:2024' } },
        provideRouter([
          { path: 'embed', component: DemoShell },
          { path: '', pathMatch: 'full', redirectTo: 'embed' },
          { path: '**', redirectTo: 'embed' },
        ]),
      ],
    });
  });

  it('forwards store.stops() as state.itinerary on submit', async () => {
    const capturing = new CapturingTransport();
    const store = new ItineraryStore();
    // Override the component-scoped agent so its transport is capturable,
    // and share the SAME store instance the shell injects.
    TestBed.overrideComponent(DemoShell, {
      set: {
        providers: [
          { provide: ItineraryStore, useValue: store },
          ...provideAgent(DEMO_AGENT_REF, {
            assistantId: 'fake',
            transport: capturing,
          }),
        ],
      },
    });

    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    const shell = fx.componentInstance as unknown as {
      agent: { submit: (i: unknown) => Promise<void> };
    };

    store.add(1, 'Louvre');
    await shell.agent.submit({ messages: [{ role: 'user', content: 'hi' }] });

    const payload = capturing.lastPayload as { itinerary?: ItineraryStop[] };
    expect(payload.itinerary).toEqual(store.stops());
    expect(payload.itinerary?.[0].place).toBe('Louvre');
  });

  it('sends reasoning_effort null by default and the explicit choice otherwise', async () => {
    const capturing = new CapturingTransport();
    TestBed.overrideComponent(DemoShell, {
      set: {
        providers: [
          ItineraryStore,
          ...provideAgent(DEMO_AGENT_REF, {
            assistantId: 'fake',
            transport: capturing,
          }),
        ],
      },
    });

    const fx = TestBed.createComponent(DemoShell);
    fx.detectChanges();
    const shell = fx.componentInstance as unknown as {
      agent: { submit: (i: unknown) => Promise<void> };
      effort: { (): string; set: (v: string) => void };
    };

    // No selection → the model's own default effort applies server-side.
    expect(shell.effort()).toBe('default');
    await shell.agent.submit({ messages: [{ role: 'user', content: 'hi' }] });
    expect((capturing.lastPayload as { reasoning_effort?: unknown }).reasoning_effort).toBeNull();

    shell.effort.set('high');
    await shell.agent.submit({ messages: [{ role: 'user', content: 'again' }] });
    expect((capturing.lastPayload as { reasoning_effort?: unknown }).reasoning_effort).toBe('high');
  });
});
