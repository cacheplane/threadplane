// libs/chat/src/lib/markdown/views/markdown-citation-reference.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { CitationsResolverService } from '../citations-resolver.service';
import { staticDelivery } from '../../agent';
import { MarkdownCitationReferenceComponent } from './markdown-citation-reference.component';
import type { MarkdownCitationReferenceNode } from '@cacheplane/partial-markdown';

function makeNode(refId: string, index: number, resolved: boolean): MarkdownCitationReferenceNode {
  return {
    id: 1, type: 'citation-reference', status: 'complete',
    parent: null, index, refId, resolved,
  } as MarkdownCitationReferenceNode;
}

@Component({
  standalone: true,
  imports: [MarkdownCitationReferenceComponent],
  providers: [CitationsResolverService],
  template: `<chat-md-citation-reference [node]="node()" />`,
})
class HostComponent {
  node = signal<MarkdownCitationReferenceNode>(makeNode('src1', 1, false));
}

describe('MarkdownCitationReferenceComponent', () => {
  it('renders a non-interactive unresolved pill when no citation is found', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const span = fixture.nativeElement.querySelector('span.chat-citation-marker');
    expect(span).toBeTruthy();
    expect(span.classList.contains('chat-citation-marker--unresolved')).toBe(true);
    expect(fixture.nativeElement.querySelector('a.chat-citation-marker')).toBeNull();
    expect(span.textContent).toContain('1');
  });

  it('renders an <a> pill with href when the citation has a url', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const svc = fixture.debugElement.injector.get(CitationsResolverService);
    svc.message.set({
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'Source', url: 'https://example.com' }],
    });
    fixture.componentInstance.node.set(makeNode('src1', 1, true));
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a.chat-citation-marker');
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBe('https://example.com');
    expect(a.getAttribute('aria-label')).toContain('opens in new tab');
    expect(a.classList.contains('chat-citation-marker--no-url')).toBe(false);
    expect(a.textContent).toContain('1');
  });

  it('renders a button-role pill without href when the citation has no url', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const svc = fixture.debugElement.injector.get(CitationsResolverService);
    svc.message.set({
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'Title only, no URL' }],
    });
    fixture.componentInstance.node.set(makeNode('src1', 1, true));
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a.chat-citation-marker--no-url');
    expect(a).toBeTruthy();
    expect(a.getAttribute('href')).toBeNull();
    expect(a.getAttribute('role')).toBe('button');
    expect(a.getAttribute('tabindex')).toBe('0');
    expect(a.textContent).toContain('1');
  });

  it('does NOT self-close when focus is immediately followed by click (tap gesture)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    const svc = fixture.debugElement.injector.get(CitationsResolverService);
    svc.message.set({
      id: 'm1', role: 'assistant', content: 'x', delivery: staticDelivery('m1'),
      citations: [{ id: 'src1', index: 1, title: 'Title only, no URL' }],
    });
    fixture.componentInstance.node.set(makeNode('src1', 1, true));
    fixture.detectChanges();
    const a = fixture.nativeElement.querySelector('a.chat-citation-marker--no-url') as HTMLElement;

    a.dispatchEvent(new FocusEvent('focus'));
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(a.getAttribute('aria-expanded')).toBe('true'); // stayed open

    // A subsequent independent click (no new focus) toggles it closed.
    a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(a.getAttribute('aria-expanded')).toBe('false');
  });
});
