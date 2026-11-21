import { signal } from '@angular/core';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import { injectThreadRouting } from './thread-routing';

// Minimal stub component needed for provideRouter routes.
@Component({ template: '', standalone: true })
class StubComponent {}

const baseRoutes = [
  { path: ':threadId', component: StubComponent },
  { path: '', pathMatch: 'full' as const, component: StubComponent },
];

describe('injectThreadRouting', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideRouter(baseRoutes)],
    });
    router = TestBed.inject(Router);
  });

  // 1. URL → signal restore on init
  it('restores threadId from URL on init', async () => {
    await router.navigateByUrl('/abc123');
    const threadId = signal<string | null>(null);

    TestBed.runInInjectionContext(() => {
      injectThreadRouting({ threadId });
    });

    // Seed is synchronous — no flush needed.
    expect(threadId()).toBe('abc123');
  });

  // 2. signal → URL
  it('navigates when threadId signal changes', async () => {
    await router.navigateByUrl('/');
    const threadId = signal<string | null>(null);
    const navigateSpy = vi.spyOn(router, 'navigate');

    TestBed.runInInjectionContext(() => {
      injectThreadRouting({ threadId });
      // Flush any initial effects before mutating.
      TestBed.flushEffects();
    });

    // Change the signal value.
    threadId.set('xyz');
    TestBed.flushEffects();

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/', 'xyz'],
      expect.objectContaining({ queryParamsHandling: 'preserve' }),
    );
  });

  // 3. validate false → redirect to bare path
  it('redirects to bare path when validate returns false', async () => {
    await router.navigateByUrl('/dead');
    const threadId = signal<string | null>(null);
    const validate = async () => false;

    const navigateSpy = vi.spyOn(router, 'navigate');

    TestBed.runInInjectionContext(() => {
      injectThreadRouting({ threadId, validate });
      TestBed.flushEffects();
    });

    // Wait for the async validate promise to resolve.
    await new Promise<void>((r) => setTimeout(r, 0));

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/'],
      expect.objectContaining({ replaceUrl: true }),
    );
  });

  // 4. bare URL → null, no thread-path navigate
  it('sets threadId to null for bare URL and does not navigate to a thread path', async () => {
    await router.navigateByUrl('/');
    const threadId = signal<string | null>('old-value');

    const navigateSpy = vi.spyOn(router, 'navigate');

    TestBed.runInInjectionContext(() => {
      injectThreadRouting({ threadId });
      TestBed.flushEffects();
    });

    expect(threadId()).toBeNull();
    // Should not have navigated to any thread path (navigate may have been
    // called for bare→bare but must not contain a thread id segment).
    const threadPathCalls = navigateSpy.mock.calls.filter(
      ([cmds]) => Array.isArray(cmds) && cmds.some((c) => c && c !== '/'),
    );
    expect(threadPathCalls).toHaveLength(0);
  });
});

// 5. custom toCommands + threadIdFromUrl (mode-prefixed /embed/<id>)
// Uses its own describe so we can configure its own TestBed with embed routes.
describe('injectThreadRouting — custom toCommands/threadIdFromUrl', () => {
  let router: Router;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'embed', component: StubComponent },
          { path: 'embed/:threadId', component: StubComponent },
          { path: '', pathMatch: 'full' as const, component: StubComponent },
        ]),
      ],
    });
    router = TestBed.inject(Router);
  });

  it('uses custom threadIdFromUrl and toCommands', async () => {
    await router.navigateByUrl('/embed/t1');
    const threadId = signal<string | null>(null);
    const threadIdFromUrl = (u: string): string | null =>
      u.split('?')[0].split('/').filter(Boolean)[1] ?? null;
    const toCommands = (id: string | null): unknown[] =>
      id ? ['/', 'embed', id] : ['/', 'embed'];

    const navigateSpy = vi.spyOn(router, 'navigate');

    TestBed.runInInjectionContext(() => {
      injectThreadRouting({ threadId, threadIdFromUrl, toCommands });
      // Flush initial effects before mutating.
      TestBed.flushEffects();
    });

    // Restore is synchronous.
    expect(threadId()).toBe('t1');

    // Now change the signal and flush — should navigate to /embed/t2.
    threadId.set('t2');
    TestBed.flushEffects();

    expect(navigateSpy).toHaveBeenCalledWith(
      ['/', 'embed', 't2'],
      expect.objectContaining({ queryParamsHandling: 'preserve' }),
    );
  });
});
