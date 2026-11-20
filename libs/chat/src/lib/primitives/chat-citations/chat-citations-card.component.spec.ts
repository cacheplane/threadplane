// libs/chat/src/lib/primitives/chat-citations/chat-citations-card.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChatCitationsCardComponent } from './chat-citations-card.component';
import type { Citation } from '../../agent';

@Component({
  standalone: true,
  imports: [ChatCitationsCardComponent],
  template: `<chat-citations-card [citation]="citation()" />`,
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

describe('ChatCitationsCardComponent', () => {
  it('renders as a link (opens source) with index, domain, title and snippet when url present', () => {
    const el = render({
      id: 'a', index: 2, title: 'RxJS intro', snippet: 'Reactive streams',
      url: 'https://www.rxjs.dev/guide',
    });
    const card = el.querySelector('a.chat-citations-card') as HTMLAnchorElement;
    expect(card).toBeTruthy();
    expect(card.getAttribute('href')).toBe('https://www.rxjs.dev/guide');
    expect(el.querySelector('.chat-citations-card__index')?.textContent?.trim()).toBe('2');
    expect(el.querySelector('.chat-citations-card__domain')?.textContent).toContain('rxjs.dev');
    expect(el.querySelector('.chat-citations-card__title')?.textContent).toContain('RxJS intro');
    expect(el.querySelector('.chat-citations-card__snippet')?.textContent).toContain('Reactive streams');
  });

  it('renders a non-link card (div) when there is no url', () => {
    const el = render({ id: 'a', index: 1, title: 'Local note' });
    expect(el.querySelector('a.chat-citations-card')).toBeNull();
    expect(el.querySelector('div.chat-citations-card')).toBeTruthy();
    expect(el.querySelector('.chat-citations-card__title')?.textContent).toContain('Local note');
  });

  it('renders a monogram when no iconUrl is supplied', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev' });
    expect(el.querySelector('.chat-citations-card__fav--mono')?.textContent?.trim()).toBe('A');
  });

  it('renders a known non-web source type icon and badge', () => {
    const el = render({ id: 'a', index: 1, title: 'Local file', sourceType: 'file' });
    const sourceIcon = el.querySelector('.chat-citation-source-icon--file');
    expect(sourceIcon).toBeTruthy();
    expect(sourceIcon?.getAttribute('aria-hidden')).toBe('true');
    expect(el.querySelector('.chat-citations-card__type')?.textContent?.trim()).toBe('File');
  });

  it('renders a generic source type icon and readable badge for custom types', () => {
    const el = render({ id: 'a', index: 1, title: 'Company memo', sourceType: 'company-knowledge' });
    expect(el.querySelector('.chat-citation-source-icon--generic')).toBeTruthy();
    expect(el.querySelector('.chat-citations-card__type')?.textContent?.trim()).toBe('Company knowledge');
  });

  it('keeps web sources without iconUrl on the monogram fallback', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev' });
    expect(el.querySelector('.chat-citations-card__fav--mono')?.textContent?.trim()).toBe('A');
    expect(el.querySelector('.chat-citation-source-icon--web')).toBeNull();
  });

  it('renders an <img> favicon when iconUrl is supplied', () => {
    const el = render({ id: 'a', index: 1, url: 'https://angular.dev', iconUrl: 'data:image/png;base64,AAA' });
    expect(el.querySelector('img.chat-citations-card__fav')).toBeTruthy();
    expect(el.querySelector('.chat-citations-card__fav--mono')).toBeNull();
    expect(el.querySelector('.chat-citation-source-icon')).toBeNull();
  });
});
