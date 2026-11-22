import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChatConnectedOverlayDirective, ChatOverlayOriginDirective } from './connected-overlay.directive';
import type { ConnectedPosition } from './connected-position';

const POSITIONS: ConnectedPosition[] = [
  { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 8 },
];

@Component({
  standalone: true,
  imports: [ChatConnectedOverlayDirective, ChatOverlayOriginDirective],
  template: `
    <button chatOverlayOrigin #o="chatOverlayOrigin">trigger</button>
    <ng-template
      chatConnectedOverlay
      [chatOverlayOrigin]="o"
      [chatOverlayOpen]="open()"
      [chatOverlayPositions]="positions"
      [chatOverlayPanelClass]="'test-panel'"
      (chatOverlayOutsideClick)="open.set(false)">
      <div class="menu-content">hello</div>
    </ng-template>
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly positions = POSITIONS;
}

describe('ChatConnectedOverlayDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    document.querySelector('.chat-overlay-container')?.remove();
  });

  const pane = () => document.querySelector('.chat-overlay-container .chat-overlay-pane');

  it('portals content to the overlay container when open, with the panel class', () => {
    expect(pane()).toBeNull();
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    const p = pane();
    expect(p).not.toBeNull();
    expect(p!.classList.contains('test-panel')).toBe(true);
    expect(p!.querySelector('.menu-content')?.textContent).toContain('hello');
  });

  it('removes the pane when closed', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    expect(pane()).toBeNull();
  });

  it('emits outsideClick on a document mousedown outside the pane and origin', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    fixture.detectChanges();
    expect(pane()).toBeNull(); // host closed via (outsideClick)
  });

  it('tears down the pane when the host is destroyed', () => {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();
    fixture.destroy();
    expect(pane()).toBeNull();
  });
});
