// @vitest-environment jsdom
import { describe, test, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { RenderLifecycleService } from './render-lifecycle.service';
import { RENDER_LIFECYCLE } from './lifecycle';
import { provideRender } from './provide-render';

describe('RenderLifecycle', () => {
  let service: RenderLifecycleService;

  beforeEach(() => {
    globalThis.console.warn = vi.fn();
    TestBed.configureTestingModule({
      providers: [provideRender({})],
    });
    service = TestBed.inject(RENDER_LIFECYCLE) as RenderLifecycleService;
  });

  test('firstMountAt is null before any mount', () => {
    expect(service.firstMountAt()).toBe(null);
  });

  test('firstMountAt captures the first mount and stays sticky', () => {
    service.notifyLifecycle({ kind: 'element', type: 'mounted', elementType: 'button' });
    const first = service.firstMountAt();
    expect(first?.elementType).toBe('button');
    service.notifyLifecycle({ kind: 'element', type: 'mounted', elementType: 'card' });
    expect(service.firstMountAt()?.elementType).toBe('button');
  });

  test('mountCount increments on each mount', () => {
    service.notifyLifecycle({ kind: 'element', type: 'mounted' });
    service.notifyLifecycle({ kind: 'element', type: 'mounted' });
    service.notifyLifecycle({ kind: 'spec', type: 'mounted' });
    expect(service.mountCount()).toBe(3);
  });

  test('lastStateChangeAt updates on state change notifications', () => {
    expect(service.lastStateChangeAt()).toBe(null);
    service.notifyStateChange();
    expect(service.lastStateChangeAt()).toBeGreaterThan(0);
  });

  test('lastHandlerInvokedAt updates with action name and timestamp', () => {
    service.notifyHandlerInvoked('save');
    expect(service.lastHandlerInvokedAt()?.action).toBe('save');
  });
});
