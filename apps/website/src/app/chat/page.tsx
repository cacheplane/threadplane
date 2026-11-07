import {
  LibraryLanding,
  type LibraryFeature,
} from '../../components/library/LibraryLanding';
import { ChatLandingCodeShowcase } from '../../components/landing/chat-landing/ChatLandingCodeShowcase';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'Chat \u2014 Threadplane',
  description:
    'Give your agents a conversation surface that belongs in your application. Start with a composition, shape it to your design system, and reach for primitives when you need more control.',
  pathname: '/chat',
  type: 'website',
});

const FEATURES: LibraryFeature[] = [
  {
    id: 'compositions',
    title: 'Start with a conversation.',
    body: 'Put messages, streaming replies, and tool activity in one place. Use a ready-made composition to get the experience into your product.',
    points: [
      'Messages and tool activity together',
      'Streaming and run status',
      'Thread navigation for connected agents',
    ],
    illustration: 'visible',
    takeaway: 'A useful starting point for your real product.',
  },
  {
    id: 'headless',
    title: 'Make it feel like you.',
    body: 'Keep your colors, typography, and interaction patterns. Use the composition or build a custom surface from the same underlying primitives.',
    points: [
      'Theme the conversation surface',
      'Compose your own message and tool views',
      'Keep the agent state connected',
    ],
    illustration: 'components',
    takeaway: 'Your design system gets the final say.',
  },
  {
    id: 'decisions',
    title: 'People have a part to play.',
    body: 'Bring decisions into the conversation. Show tool calls, surface approvals, and give structured output a home alongside the messages.',
    points: [
      'Tool activity with context',
      'Approval surfaces for human decisions',
      'Generative UI through framework integrations',
    ],
    illustration: 'reviewable',
    takeaway: 'A conversation can do more than talk.',
  },
];

export default async function ChatPage() {
  const media = SECTION_MEDIA.libChat;
  const panes = await buildPanes(media, media.video?.url ?? '');
  return (
    <LibraryLanding
      name="Chat"
      slug="chat"
      headline={
        <>
          Less chat plumbing.
          <br />
          More product.
        </>
      }
      description="Give your agents a conversation surface that belongs in your application. Start with a composition, shape it to your design system, and reach for primitives when you need more control."
      reactDocs="/docs/react/chat/guides/generative-ui"
      angularDocs="/docs/angular/chat/getting-started/introduction"
      features={FEATURES}
      panes={panes}
      code={<ChatLandingCodeShowcase showIntroduction={false} />}
      technicalNote="The examples below show Angular chat compositions and theming. React has its own components and integration guide; use the framework docs for the supported surface."
      demoHref="/docs/angular/chat/guides/generative-ui?mode=run"
      guideHref="/docs/angular/chat/concepts/primitives-vs-compositions"
      guideLabel="Explore the primitives"
      paper="chat"
      formPolicy={getFormPolicy()}
    />
  );
}
