import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ExampleChatLayoutComponent } from './example-chat-layout.component';
import { ExampleSplitLayoutComponent } from './example-split-layout.component';

describe.each([ExampleChatLayoutComponent, ExampleSplitLayoutComponent])('%s visible viewport', (component) => {
  afterEach(() => vi.unstubAllGlobals());

  it('resizes with the software keyboard and rotation without changing focus or pinching zoom', () => {
    const viewport = Object.assign(new EventTarget(), { height: 714, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', viewport);
    const fixture = TestBed.createComponent(component);
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    const input = document.createElement('textarea');
    host.append(input);
    input.focus();
    viewport.height = 377;
    viewport.dispatchEvent(new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('377px');
    expect(document.activeElement).toBe(input);
    viewport.offsetTop = 154;
    viewport.dispatchEvent(new Event('scroll'));
    expect(host.style.getPropertyValue('--example-viewport-top')).toBe('154px');
    viewport.height = 190;
    viewport.dispatchEvent(new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('190px');
    viewport.scale = 2;
    viewport.height = 95;
    viewport.dispatchEvent(new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('190px');
    viewport.scale = 1;
    viewport.height = 714;
    viewport.dispatchEvent(new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('714px');
    fixture.destroy();
    viewport.height = 300;
    viewport.dispatchEvent(new Event('resize'));
    expect(host.style.getPropertyValue('--example-viewport-height')).toBe('714px');
  });
});
