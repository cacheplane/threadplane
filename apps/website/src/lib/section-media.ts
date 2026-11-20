import { AG_UI_CLIP, LANGGRAPH_CLIP, RENDER_CLIP, SHIP_CLIP, type DemoClip } from './demo-media';
import type { SolutionCodeBlocks } from './solutions-data';

/**
 * What a homepage section can show. Every medium is optional and that is
 * load-bearing: a section with one medium renders bare, with no tablist, and
 * sections gain tabs as media is produced rather than blocking on a recording
 * that does not exist yet.
 */
export interface SectionMedia {
  video?: DemoClip;
  code?: SolutionCodeBlocks;
  /**
   * Opens the live demo on a curated scenario via `?featured=`.
   *
   * A KEY into `examples/chat`'s suggestion list, never free text — the demo
   * falls back to its default for an id it does not recognise, so a link can
   * never put arbitrary words inside the demo UI. Renaming a suggestion's id
   * there breaks this link, which is why those ids are explicit rather than
   * derived from labels.
   */
  live?: { featured: string; mode?: 'embed' | 'popup' | 'sidebar' };
}

export const SECTION_MEDIA: Record<
  | 'ship'
  | 'test'
  | 'libLanggraph'
  | 'libChat'
  | 'libAgUi'
  | 'libRender',
  SectionMedia
> = {
  ship: {
    video: SHIP_CLIP,
    live: { featured: 'tell-me-about-coral' },
    code: [
      {
        label: 'app.config.ts — durable threads',
        language: 'typescript',
        source: `provideAgent(DEMO_AGENT, {
  // The thread id is the durability boundary. Persist it (URL, storage,
  // your own records) and the conversation survives a reload, a new tab,
  // or a different device — the messages live in the checkpoint, not here.
  threadId: signal(threadIdFromUrl()),
  createSession: (context) =>
    createSession({
      apiUrl: 'https://your-deployment.langgraph.app',
      assistantId: 'demo',
      threadId: context.threadId,
      onThreadId: context.onThreadId,
    }),
});`,
      },
    ],
  },
  test: {
    code: [
      {
        label: 'Code',
        language: 'typescript',
        source: `import { TestBed } from '@angular/core/testing';
import { provideFakeAgent } from '@threadplane/angular/testing';
import { SupportAgentComponent } from './support-agent.component';

it('renders the streamed reply', async () => {
  TestBed.configureTestingModule({
    imports: [SupportAgentComponent],
    providers: [provideFakeAgent({ tokens: ['Hello', ' from', ' Threadplane'], delayMs: 0 })],
  });
  const fixture = TestBed.createComponent(SupportAgentComponent);
  fixture.detectChanges();

  const textarea: HTMLTextAreaElement = fixture.nativeElement.querySelector('textarea');
  textarea.value = 'What can Threadplane do?';
  textarea.dispatchEvent(new Event('input'));
  fixture.detectChanges();

  const send: HTMLButtonElement = fixture.nativeElement.querySelector('button[aria-label="Send message"]');
  send.click();

  await fixture.whenStable();
  fixture.detectChanges();

  expect(fixture.nativeElement.textContent).toContain('Hello from Threadplane');
});`,
      },
    ],
  },

  // The four library pages (/langgraph, /chat, /ag-ui, /render) reuse this
  // table for their first FeatureBlock's medium switcher — except /ag-ui,
  // whose switcher replaces its SECOND block's mock (see libAgUi below). The
  // pages consume these entries via buildPanes; the page-local static mocks
  // they were lifted from are gone.
  libLanggraph: {
    video: LANGGRAPH_CLIP,
    live: { featured: 'tell-me-about-coral' },
    code: [
      {
        label: 'app.config.ts',
        language: 'typescript',
        source: `import { injectAgent, provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/langgraph';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({
      createSession: (context) =>
        createSession({
          apiUrl: '/agent',
          assistantId: 'my-agent',
          threadId: context.threadId,
          onThreadId: context.onThreadId,
        }),
    }),
  ],
};

// any component
export class ChatComponent {
  agent = injectAgent();
  messages = this.agent.messages;
  status = this.agent.status;
}`,
      },
    ],
  },
  libChat: {
    video: SHIP_CLIP,
    live: { featured: 'tell-me-about-coral' },
    // No code pane: the /chat page's first FeatureBlock mocks a chat-debug
    // panel (pills, tool call, replay footer), not a source snippet.
  },
  libAgUi: {
    video: AG_UI_CLIP,
    // No live tab: the demo host speaks LangGraph, and wiring AG-UI into it
    // live is out of scope for this arc. Unlike the other three pages, this
    // switcher lands on /ag-ui's SECOND FeatureBlock — its first block's
    // visual is the real BackendsGrid, not a mock.
    code: [
      {
        label: 'app.config.ts',
        language: 'typescript',
        source: `import { injectAgent, provideAgent } from '@threadplane/angular';
import { createSession } from '@threadplane/ag-ui';
import { ChatComponent } from '@threadplane/chat';

// app.config.ts
export const appConfig: ApplicationConfig = {
  providers: [
    provideAgent({
      createSession: (context) =>
        createSession({
          url: 'https://your.agent.endpoint',
          threadId: context.threadId ?? undefined,
        }),
    }),
  ],
};

// component
@Component({
  imports: [ChatComponent],
  template: \`<chat [agent]="agent" />\`,
})
export class App {
  protected readonly agent = injectAgent();
}`,
      },
    ],
  },
  libRender: {
    video: RENDER_CLIP,
    live: { featured: 'generative-ui-contact-form' },
    code: [
      {
        // 'json' isn't in SolutionCode's language union (typescript | python
        // | html), so this stays tagged typescript for Shiki highlighting.
        label: 'spec.json',
        language: 'typescript',
        source: `{
  "type": "card",
  "props": {
    "title": "Q3 revenue",
    "value": "$4.2M",
    "delta": "+18%"
  }
}`,
      },
    ],
  },
};
