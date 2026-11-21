// libs/chat/src/lib/primitives/chat-citations/chat-citations.component.spec.ts
import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ChatCitationsComponent, ChatCitationCardTemplateDirective } from './chat-citations.component';
import { staticDelivery, type Message } from '../../agent';

function msg(citations: Message['citations']): Message {
  return { id: 'm1', role: 'assistant', content: 'x', citations, delivery: staticDelivery('m1') };
}

/** The Sources panel is collapsed by default; open it to inspect the cards. */
function expand(fixture: ComponentFixture<unknown>): void {
  fixture.nativeElement.querySelector('.chat-citations__header')?.click();
  fixture.detectChanges();
}

@Component({
  standalone: true,
  imports: [ChatCitationsComponent],
  template: `<chat-citations [message]="message()" />`,
})
class HostComponent {
  message = signal<Message>(msg(undefined));
}

describe('ChatCitationsComponent', () => {
  it('renders nothing when citations is undefined', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-citations')).toBeNull();
  });

  it('renders nothing when citations is empty', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-citations')).toBeNull();
  });

  it('is collapsed by default — header shows, list hidden', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([{ id: 'a', index: 1, title: 'A' }]));
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.chat-citations__header') as HTMLButtonElement;
    expect(header).toBeTruthy();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.chat-citations__list')).toBeNull();
  });

  it('renders citations sorted by index (once expanded)', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([
      { id: 'b', index: 2, title: 'B' },
      { id: 'a', index: 1, title: 'A' },
    ]));
    fixture.detectChanges();
    expand(fixture);
    const titles = Array.from(fixture.nativeElement.querySelectorAll('.chat-citations-card__title'))
      .map((el: any) => el.textContent.trim());
    expect(titles).toEqual(['A', 'B']);
  });

  it('uses ContentChild template slot when provided (once expanded)', () => {
    @Component({
      standalone: true,
      imports: [ChatCitationsComponent, ChatCitationCardTemplateDirective],
      template: `
        <chat-citations [message]="message">
          <ng-template chatCitationCard let-c>
            <span class="custom-card">{{ c.title }}</span>
          </ng-template>
        </chat-citations>
      `,
    })
    class CustomHost {
      message: Message = msg([{ id: 'a', index: 1, title: 'Custom' }]);
    }
    const fixture = TestBed.createComponent(CustomHost);
    fixture.detectChanges();
    expand(fixture);
    expect(fixture.nativeElement.querySelector('.custom-card')?.textContent.trim()).toBe('Custom');
    expect(fixture.nativeElement.querySelector('.chat-citations-card')).toBeNull();
  });

  it('merges markdown sidecar citations when resolver is available — bug #197 regression', async () => {
    // Live Chrome smoke caught: when citations come from Pandoc-formatted
    // [^id]: defs in content (no provider metadata), inline markers resolved
    // correctly via the markdown sidecar but the sources panel never rendered.
    const { CitationsResolverService } = await import('../../markdown/citations-resolver.service');
    @Component({
      standalone: true,
      imports: [ChatCitationsComponent],
      providers: [CitationsResolverService],
      template: `<chat-citations [message]="message" />`,
    })
    class ResolverHost {
      message: Message = msg(undefined); // no provider citations
    }
    const fixture = TestBed.createComponent(ResolverHost);
    const resolver = fixture.debugElement.injector.get(CitationsResolverService);
    resolver.markdownDefs.set(new Map([
      ['src1', {
        id: 'src1', index: 1, status: 'complete',
        children: [
          { id: 1, type: 'text', status: 'complete', parent: null, index: 0, text: 'Wikipedia ' },
          { id: 2, type: 'autolink', status: 'complete', parent: null, index: 1,
            url: 'https://en.wikipedia.org/wiki/Coral_reef',
            text: 'https://en.wikipedia.org/wiki/Coral_reef' },
        ],
      } as never],
    ]));
    fixture.detectChanges();
    expand(fixture);
    const cards = fixture.nativeElement.querySelectorAll('.chat-citations-card');
    expect(cards.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Wikipedia');
  });

  it('Message.citations takes precedence over markdown sidecar when ids overlap', async () => {
    const { CitationsResolverService } = await import('../../markdown/citations-resolver.service');
    @Component({
      standalone: true,
      imports: [ChatCitationsComponent],
      providers: [CitationsResolverService],
      template: `<chat-citations [message]="message" />`,
    })
    class PrecedenceHost {
      message: Message = msg([{ id: 'src1', index: 1, title: 'From message' }]);
    }
    const fixture = TestBed.createComponent(PrecedenceHost);
    const resolver = fixture.debugElement.injector.get(CitationsResolverService);
    resolver.markdownDefs.set(new Map([
      ['src1', { id: 'src1', index: 1, status: 'complete',
        children: [{ id: 1, type: 'text', status: 'complete', parent: null, index: 0, text: 'From markdown' }],
      } as never],
    ]));
    fixture.detectChanges();
    expand(fixture);
    const cards = fixture.nativeElement.querySelectorAll('.chat-citations-card');
    expect(cards.length).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('From message');
    expect(fixture.nativeElement.textContent).not.toContain('From markdown');
  });

  it('shows a Sources header with the citation count', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([
      { id: 'a', index: 1, title: 'A' },
      { id: 'b', index: 2, title: 'B' },
    ]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-citations__heading')?.textContent).toContain('Sources');
    expect(fixture.nativeElement.querySelector('.chat-citations__count')?.textContent?.trim()).toBe('2');
  });

  it('uses source visual precedence in the header stack', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([
      { id: 'file', index: 1, title: 'File', sourceType: 'file' },
      { id: 'web', index: 2, title: 'Web', url: 'https://angular.dev' },
    ]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.chat-citations__source-icon--file')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.chat-citations__fav--mono')?.textContent?.trim()).toBe('A');
  });

  it('prefers provider iconUrl over source type icons in the header stack', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([
      {
        id: 'provider-icon',
        index: 1,
        title: 'File with provider icon',
        sourceType: 'file',
        iconUrl: 'data:image/png;base64,AAA',
      },
    ]));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('img.chat-citations__fav')).toBeTruthy();
    expect(fixture.nativeElement.querySelector('.chat-citations__source-icon--file')).toBeNull();
  });

  it('expands and collapses the list when the header is toggled', () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.message.set(msg([{ id: 'a', index: 1, title: 'A' }]));
    fixture.detectChanges();
    const header = fixture.nativeElement.querySelector('.chat-citations__header') as HTMLButtonElement;
    // collapsed by default
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.chat-citations__list')).toBeNull();

    header.click();
    fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('true');
    expect(fixture.nativeElement.querySelector('.chat-citations__list')).toBeTruthy();

    header.click();
    fixture.detectChanges();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(fixture.nativeElement.querySelector('.chat-citations__list')).toBeNull();
  });
});
