import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, expect, it, vi } from 'vitest';
import { ExampleTranscriptDirective } from './example-transcript.directive';

@Component({
  imports: [ExampleTranscriptDirective],
  template: '<div exampleTranscript><div>Conversation</div></div>',
})
class Host {}

afterEach(() => {
  TestBed.resetTestingModule();
  vi.unstubAllGlobals();
});

it('follows content and viewport growth only while pinned and releases the observer', async () => {
  let notify = () => {
    throw new Error('Observer not installed');
  };
  const observe = vi.fn(),
    disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        notify = () => callback([], this as unknown as ResizeObserver);
      }
      observe = observe;
      disconnect = disconnect;
    }
  );
  await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  const fixture = TestBed.createComponent(Host);
  fixture.detectChanges();
  await fixture.whenStable();
  const el = fixture.nativeElement.firstElementChild as HTMLElement;
  expect(el.getAttribute('role')).toBe('region');
  expect(el.getAttribute('aria-label')).toBe('Conversation');
  expect(el.getAttribute('tabindex')).toBe('0');
  let top = 0,
    height = 900;
  Object.defineProperties(el, {
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 100 },
    scrollTop: {
      get: () => top,
      set: (value) => {
        top = value;
      },
    },
  });
  notify();
  expect(top).toBe(900);
  expect(observe).toHaveBeenCalledWith(el);
  expect(observe).toHaveBeenCalledWith(el.firstElementChild);
  // WebKit may deliver a programmatic scroll after another streamed chunk
  // has grown the content. The reader has not moved toward older messages.
  height = 1100;
  el.dispatchEvent(new Event('scroll'));
  notify();
  expect(top).toBe(1100);
  top = 200;
  el.dispatchEvent(new Event('scroll'));
  height = 1200;
  notify();
  expect(top).toBe(200);
  top = 1100;
  el.dispatchEvent(new Event('scroll'));
  height = 1400;
  notify();
  expect(top).toBe(1400);
  fixture.destroy();
  expect(disconnect).toHaveBeenCalledOnce();
  top = 100;
  notify();
  expect(top).toBe(100);
});
