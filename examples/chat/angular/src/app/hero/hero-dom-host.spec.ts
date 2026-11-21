import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChatComponent, ChatInterruptPanelComponent, type Agent } from '@threadplane/chat';
import { injectAgent } from '@threadplane/angular';
import { provideFakeAgent } from '@threadplane/angular/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  acceptButtonOf,
  composerOf,
  cursorPointFor,
  pressButton,
  sendButtonOf,
  typeIntoTextarea,
} from './hero-dom-host';

/** Minimal Agent stand-in: the panel only reads `interrupts()`. */
const interruptedAgent = {
  interrupts: signal([{ id: 'pause-1', value: { reason: 'delete 12 backups' } }]),
} as unknown as Agent;

@Component({
  standalone: true,
  imports: [ChatComponent, ChatInterruptPanelComponent],
  providers: [provideFakeAgent({ tokens: ['hi'] })],
  template: `
    <div data-root>
      <chat-interrupt-panel [agent]="stub" />
      <chat [agent]="agent" />
    </div>
  `,
})
class DomHostFixture {
  readonly agent = injectAgent();
  readonly stub = interruptedAgent;
}

describe('hero DOM host', () => {
  let fx: ComponentFixture<DomHostFixture>;
  let root: HTMLElement;

  beforeEach(async () => {
    TestBed.configureTestingModule({ imports: [DomHostFixture] });
    fx = TestBed.createComponent(DomHostFixture);
    fx.detectChanges();
    await fx.whenStable();
    fx.detectChanges();
    root = (fx.nativeElement as HTMLElement).querySelector('[data-root]') as HTMLElement;
  });

  it('resolves the composer, the Send button and the Accept button', () => {
    expect(composerOf(root)).toBeInstanceOf(HTMLTextAreaElement);
    expect(sendButtonOf(root)).toBeInstanceOf(HTMLButtonElement);
    expect(acceptButtonOf(root)?.textContent).toMatch(/accept/i);
  });

  it('typing into the composer enables Send', async () => {
    expect(sendButtonOf(root)!.disabled).toBe(true);
    await typeIntoTextarea(composerOf(root), 'hello', 0, true);
    fx.detectChanges();
    expect(composerOf(root)!.value).toBe('hello');
    expect(sendButtonOf(root)!.disabled).toBe(false);
  });

  it('types character by character when not instant', async () => {
    const seen: string[] = [];
    const ta = composerOf(root)!;
    ta.addEventListener('input', () => seen.push(ta.value));
    await typeIntoTextarea(ta, 'abc', 0);
    expect(seen).toEqual(['a', 'ab', 'abc']);
  });

  it('pressButton reports whether it had a button to click', () => {
    let clicks = 0;
    const btn = acceptButtonOf(root)!;
    btn.addEventListener('click', () => clicks++);
    expect(pressButton(null)).toBe(false);
    expect(pressButton(btn)).toBe(true);
    expect(clicks).toBe(1);
  });

  it('cursorPointFor returns coordinates relative to the root, and null for nothing', () => {
    expect(cursorPointFor(root, null)).toBeNull();
    const point = cursorPointFor(root, sendButtonOf(root));
    expect(point).not.toBeNull();
    expect(Number.isFinite(point!.x)).toBe(true);
    expect(Number.isFinite(point!.y)).toBe(true);
  });

  it('cursorPointFor subtracts the root offset and insets from the left edge', () => {
    const fakeRoot = { getBoundingClientRect: () => ({ left: 100, top: 50 }) } as unknown as HTMLElement;
    const el = { getBoundingClientRect: () => ({ left: 200, top: 90, width: 20, height: 10 }) } as unknown as Element;
    expect(cursorPointFor(fakeRoot, el)).toEqual({ x: 110, y: 45 });
  });

  it('cursorPointFor caps the left inset at 40px for wide elements', () => {
    const fakeRoot = { getBoundingClientRect: () => ({ left: 0, top: 0 }) } as unknown as HTMLElement;
    const el = { getBoundingClientRect: () => ({ left: 0, top: 0, width: 600, height: 40 }) } as unknown as Element;
    expect(cursorPointFor(fakeRoot, el)).toEqual({ x: 40, y: 20 });
  });
});
