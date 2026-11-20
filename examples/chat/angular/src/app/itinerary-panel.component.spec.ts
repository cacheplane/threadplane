import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { injectAgent } from '@threadplane/angular';
import { provideFakeAgent } from '@threadplane/angular/testing';
import type { DemoAgent } from './shell/agent-ref';
import { DEMO_AGENT } from './shell/shell-tokens';
import { ItineraryPanelComponent } from './itinerary-panel.component';
import { ItineraryStore } from './itinerary-store';

// The panel reads the shell's agent through DEMO_AGENT. Bind that token to an
// in-memory fake agent so the panel resolves without a shell or a backend.
const fakeAgentProvider = [
  ...provideFakeAgent({ delayMs: 0 }),
  { provide: DEMO_AGENT, useFactory: () => injectAgent() as unknown as DemoAgent },
];

describe('ItineraryPanelComponent — agent-edit pulse', () => {
  beforeEach(() => localStorage.clear());

  it('applies .itin__stop--pulse to the row matching recentlyChangedId', async () => {
    TestBed.configureTestingModule({
      providers: [
        ItineraryStore,
        ...fakeAgentProvider,
      ],
    });
    const store = TestBed.inject(ItineraryStore);
    const added = store.add(3, 'Sacré-Cœur'); // agent source by default

    const fixture = TestBed.createComponent(ItineraryPanelComponent);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.itin__stop');
    const pulsing = Array.from(rows).filter((el: any) =>
      el.classList.contains('itin__stop--pulse'),
    );
    expect(pulsing.length).toBe(1);
    expect((pulsing[0] as HTMLElement).textContent).toContain('Sacré-Cœur');
    // satisfy lint
    expect(added.id).toBeDefined();
  });

  it('toggles the itin--collapsed host class via the collapse button', () => {
    TestBed.configureTestingModule({
      providers: [
        ItineraryStore,
        ...fakeAgentProvider,
      ],
    });

    const fixture = TestBed.createComponent(ItineraryPanelComponent);
    fixture.detectChanges();

    const host = fixture.nativeElement as HTMLElement;
    expect(host.classList.contains('itin--collapsed')).toBe(false);

    const toggle = host.querySelector('.itin__collapse') as HTMLButtonElement;
    expect(toggle).toBeTruthy();

    toggle.click();
    fixture.detectChanges();
    expect(host.classList.contains('itin--collapsed')).toBe(true);

    toggle.click();
    fixture.detectChanges();
    expect(host.classList.contains('itin--collapsed')).toBe(false);
  });

  it('highlights the focused row', () => {
    TestBed.configureTestingModule({
      providers: [
        ItineraryStore,
        ...fakeAgentProvider,
      ],
    });
    const store = TestBed.inject(ItineraryStore);
    // The chat-demo store starts empty, so seed a stop before focusing it.
    const stop = store.add(1, 'Louvre');
    store.focus(stop.id);

    const fixture = TestBed.createComponent(ItineraryPanelComponent);
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('.itin__stop');
    const pulsing = Array.from(rows).filter((el: any) =>
      el.classList.contains('itin__stop--pulse'),
    );
    expect(pulsing.length).toBe(1);
  });
});
