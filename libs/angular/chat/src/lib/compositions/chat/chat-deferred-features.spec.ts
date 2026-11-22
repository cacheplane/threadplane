// libs/angular/chat/src/lib/compositions/chat/chat-deferred-features.spec.ts
//
// The thread list, the model picker and inline citation markers load on
// demand, from their own entry points. Each shows once its deferred block
// resolves; until then nothing of it is loaded.
import { describe, expect, it } from 'vitest';
import { Component, signal } from '@angular/core';
import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
import type { MarkdownCitationReferenceNode } from '@cacheplane/partial-markdown';
import { CitationsResolverService } from '@threadplane/angular/chat/shared';
import { ChatComponent } from './chat.component';
import { mockAgent } from '../../testing/mock-agent';
import { staticDelivery } from '../../agent';
import { MarkdownCitationReferenceHostComponent } from '../../markdown/views/markdown-citation-reference-host.component';

async function completeDeferBlocks(fixture: { getDeferBlocks(): Promise<{ render(state: DeferBlockState): Promise<void> }[]> }) {
  for (const block of await fixture.getDeferBlocks()) await block.render(DeferBlockState.Complete);
}

describe('ChatComponent deferred features', () => {
  it('renders the thread list once its deferred block loads', async () => {
    TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual });
    const fixture = TestBed.createComponent(ChatComponent);
    // A conversation in progress: the welcome screen has no thread list.
    fixture.componentRef.setInput('agent', mockAgent({
      messages: [{ id: 'u', role: 'user', content: 'Hello', delivery: staticDelivery('u') }],
    }));
    fixture.componentRef.setInput('threads', [{ id: 't1', title: 'Trip planning' }]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.chat-shell__sidebar')).not.toBeNull();
    expect(root.querySelector('chat-thread-list')).toBeNull();

    await completeDeferBlocks(fixture);
    fixture.detectChanges();
    expect(root.querySelector('chat-thread-list')?.textContent).toContain('Trip planning');
  });

  it('renders the model picker in the composer once its deferred block loads', async () => {
    TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual });
    const fixture = TestBed.createComponent(ChatComponent);
    fixture.componentRef.setInput('agent', mockAgent({ messages: [] }));
    fixture.componentRef.setInput('modelOptions', [{ value: 'fast', label: 'Fast' }]);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('chat-select')).toBeNull();

    await completeDeferBlocks(fixture);
    fixture.detectChanges();
    // Projected into the composer pill, as before the deferral.
    expect(root.querySelector('chat-input chat-select')).not.toBeNull();
  });
});

@Component({
  standalone: true,
  imports: [MarkdownCitationReferenceHostComponent],
  providers: [CitationsResolverService],
  template: `<chat-md-citation-reference-host [node]="node()" />`,
})
class CitationHost {
  readonly node = signal({
    id: 1, type: 'citation-reference', status: 'complete',
    parent: null, index: 3, refId: 'src', resolved: false,
  } as unknown as MarkdownCitationReferenceNode);
}

describe('MarkdownCitationReferenceHostComponent', () => {
  it('shows the marker number until the citation marker loads, then the marker', async () => {
    TestBed.configureTestingModule({ deferBlockBehavior: DeferBlockBehavior.Manual });
    const fixture = TestBed.createComponent(CitationHost);
    fixture.detectChanges();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('chat-md-citation-reference')).toBeNull();
    expect(root.textContent?.trim()).toBe('3');

    await completeDeferBlocks(fixture);
    fixture.detectChanges();
    expect(root.querySelector('chat-md-citation-reference .chat-citation-marker')?.textContent).toContain('3');
  });
});
