// libs/angular/chat/src/lib/streaming/streaming-markdown.registry-override.spec.ts
//
// WHAT THIS PINS. `<chat-streaming-md>` provides MARKDOWN_VIEW_REGISTRY on its
// own component injector so `<chat-md-children>` and the table-row view can
// resolve it. Providing it unconditionally from the component's own default
// made an application- or route-level provider for the same token unreachable:
// the component injector always won. Resolution now runs input first, then an
// ancestor injector, then the built-in default — so an app-wide override
// actually reaches the markdown node components.
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { overrideViews, type ViewRegistry } from '@threadplane/angular/render';
import { describe, expect, it } from 'vitest';
import { cacheplaneMarkdownViews } from '../markdown/cacheplane-markdown-views';
import { MARKDOWN_VIEW_REGISTRY } from '../markdown/markdown-view-registry';
import { ChatComponent } from '../compositions/chat/chat.component';
import { staticDelivery } from '../agent';
import { mockAgent } from '../testing/mock-agent';
import {
  ChatStreamingMdComponent,
  type StreamingMarkdownDocument,
} from './streaming-markdown.component';

@Component({
  standalone: true,
  selector: 'chat-test-loud-paragraph',
  template: `<p class="loud-paragraph"><ng-content /></p>`,
})
class LoudParagraphComponent {
  /** The markdown node the registry binds onto every view component. */
  readonly node = input<unknown>();
}

const customViews = (): ViewRegistry =>
  overrideViews(cacheplaneMarkdownViews, {
    paragraph: LoudParagraphComponent,
  });

const doc = (content: string): StreamingMarkdownDocument => ({
  generation: 'g1',
  phase: 'complete',
  content,
});

@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md [document]="document()" />`,
})
class PlainHost {
  readonly document = signal(doc('Hello world'));
}

@Component({
  standalone: true,
  imports: [ChatStreamingMdComponent],
  template: `<chat-streaming-md
    [document]="document()"
    [viewRegistry]="registry()"
  />`,
})
class InputHost {
  readonly document = signal(doc('Hello world'));
  readonly registry = signal<ViewRegistry | undefined>(undefined);
}

@Component({
  standalone: true,
  imports: [ChatComponent],
  template: `<chat [agent]="agent" />`,
})
class ChatHost {
  readonly agent = mockAgent({
    messages: [
      {
        id: 'm1',
        role: 'assistant',
        content: 'Hello world',
        delivery: staticDelivery('m1'),
      },
    ],
  });
}

describe('<chat-streaming-md> markdown view registry resolution', () => {
  it('uses the built-in default when nothing overrides it', () => {
    const fixture = TestBed.createComponent(PlainHost);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.loud-paragraph')
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('p')).toBeTruthy();
  });

  it('uses a registry provided by an ancestor injector', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MARKDOWN_VIEW_REGISTRY, useValue: customViews() },
      ],
    });

    const fixture = TestBed.createComponent(PlainHost);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.loud-paragraph'),
      'an app-level MARKDOWN_VIEW_REGISTRY must reach the markdown nodes'
    ).toBeTruthy();
  });

  it('lets the [viewRegistry] input win over an ancestor provider', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MARKDOWN_VIEW_REGISTRY, useValue: customViews() },
      ],
    });

    const fixture = TestBed.createComponent(InputHost);
    fixture.componentInstance.registry.set(cacheplaneMarkdownViews);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.loud-paragraph'),
      'the explicit input is the most specific override'
    ).toBeNull();
    expect(fixture.nativeElement.querySelector('p')).toBeTruthy();
  });

  it('reaches markdown rendered inside <chat> without forwarding anything', () => {
    TestBed.configureTestingModule({
      providers: [
        { provide: MARKDOWN_VIEW_REGISTRY, useValue: customViews() },
      ],
    });

    const fixture = TestBed.createComponent(ChatHost);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.loud-paragraph'),
      '<chat> renders assistant markdown through <chat-streaming-md>'
    ).toBeTruthy();
  });
});
