// libs/angular/chat/src/lib/primitives/chat-citations/chat-citation-preview.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatCitationPreviewComponent } from './chat-citation-preview.component';
import type { Citation } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatCitationPreviewComponent],
  template: `<chat-citation-preview [citation]="citation()" />`,
})
class HostComponent {
  citation = signal<Citation>({ id: 'a', index: 1 });
}

function render(c: Citation) {
  const fixture = TestBed.createComponent(HostComponent);
  fixture.componentInstance.citation.set(c);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('ChatCitationPreviewComponent', () => {
  it('shows domain, title, snippet and an Open source link when url present', () => {
    const el = render({
      id: 'a', index: 1, title: 'RxJS intro', snippet: 'Reactive streams',
      url: 'https://www.rxjs.dev/guide',
    });
    expect(el.querySelector('.chat-citation-preview__domain')?.textContent).toContain('rxjs.dev');
    expect(el.querySelector('.chat-citation-preview__title')?.textContent).toContain('RxJS intro');
    expect(el.querySelector('.chat-citation-preview__snippet')?.textContent).toContain('Reactive streams');
    const open = el.querySelector('a.chat-citation-preview__open') as HTMLAnchorElement;
    expect(open).toBeTruthy();
    expect(open.getAttribute('href')).toBe('https://www.rxjs.dev/guide');
  });

  it('omits the Open source footer when there is no url', () => {
    const el = render({ id: 'a', index: 1, title: 'Local note', snippet: 'from a file' });
    expect(el.querySelector('.chat-citation-preview__open')).toBeNull();
  });

  it('renders a monogram when no iconUrl is supplied', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev' });
    const mono = el.querySelector('.chat-citation-preview__fav--mono');
    expect(mono?.textContent?.trim()).toBe('A');
  });

  it('renders a known non-web source type icon and badge', () => {
    const el = render({ id: 'a', index: 1, title: 'Local file', sourceType: 'file' });
    const sourceIcon = el.querySelector('.chat-citation-source-icon--file');
    expect(sourceIcon).toBeTruthy();
    expect(sourceIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.chat-citation-preview__type')?.textContent?.trim()).toBe('File');
  });

  it('renders a generic source type icon and readable badge for custom types', () => {
    const el = render({ id: 'a', index: 1, title: 'Company memo', sourceType: 'company-knowledge' });
    expect(el.querySelector('.chat-citation-source-icon--generic')).toBeTruthy();
    expect(el.querySelector('.chat-citation-preview__type')?.textContent?.trim()).toBe('Company knowledge');
  });

  it('keeps web sources without iconUrl on the monogram fallback', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev' });
    expect(el.querySelector('.chat-citation-preview__fav--mono')?.textContent?.trim()).toBe('A');
    expect(el.querySelector('.chat-citation-source-icon--web')).toBeNull();
  });

  it('renders an <img> favicon when iconUrl is supplied', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev', iconUrl: 'data:image/png;base64,AAA' });
    expect(el.querySelector('img.chat-citation-preview__fav')).toBeTruthy();
    expect(el.querySelector('.chat-citation-preview__fav--mono')).toBeNull();
    expect(el.querySelector('.chat-citation-source-icon')).toBeNull();
  });

  it('shows a freshness label from publishedAt', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev', publishedAt: '2024-04-10' });
    expect(el.querySelector('.chat-citation-preview__meta')?.textContent).toMatch(/2024/);
  });
});
