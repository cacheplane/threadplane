import {
  LibraryLanding,
  type LibraryFeature,
} from '../../components/library/LibraryLanding';
import { LangGraphCodeShowcase } from '../../components/landing/langgraph/LangGraphCodeShowcase';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'LangGraph \u2014 Threadplane',
  description:
    'Bring streaming, persistent threads, and human decisions into your application. Keep LangGraph in charge of the agent and your team in charge of the experience.',
  pathname: '/langgraph',
  type: 'website',
});

const FEATURES: LibraryFeature[] = [
  {
    id: 'providers',
    title: 'Your backend. Connected.',
    body: 'Connect to LangGraph directly, whether you host it yourself or deploy on LangSmith. Keep authentication and deployment decisions in your application.',
    points: [
      'Native LangGraph connection',
      'Your authentication and infrastructure',
      'Reactive state for the interface',
    ],
    illustration: 'connections',
    takeaway: 'The graph runs there. The experience belongs here.',
  },
  {
    id: 'signals',
    title: 'The whole conversation.',
    body: 'Give users more than a stream of text. Bring messages, tool activity, and run status into a conversation they can follow.',
    points: [
      'Streaming messages and tool progress',
      'Errors and status in the same interface',
      'Framework-specific bindings for your app',
    ],
    illustration: 'visible',
    takeaway: 'Show the work as it happens.',
  },
  {
    id: 'threads',
    title: 'A thread worth keeping.',
    body: 'Use LangGraph threads and checkpoints to return to the work. Let people inspect history, review an interrupt, and continue with context.',
    points: [
      'Persistent threads and checkpoint history',
      'Human decisions at interrupt boundaries',
      'History and branching through LangGraph',
    ],
    illustration: 'persistent',
    takeaway: 'Pick up the conversation with its context intact.',
  },
];

export default async function LangGraphPage() {
  const media = SECTION_MEDIA.libLanggraph;
  const panes = await buildPanes(media, media.video?.url ?? '');
  return (
    <LibraryLanding
      name="LangGraph"
      slug="langgraph"
      headline={
        <>
          Your graph.
          <br />A UI that keeps up.
        </>
      }
      description="Bring streaming, persistent threads, and human decisions into your application. Keep LangGraph in charge of the agent and your team in charge of the experience."
      reactDocs="/docs/react/langgraph/guides/streaming"
      angularDocs="/docs/angular/langgraph/getting-started/introduction"
      features={FEATURES}
      panes={panes}
      code={<LangGraphCodeShowcase showIntroduction={false} />}
      technicalNote="These Angular examples connect directly to LangGraph. The React guide covers observing an app-owned session with useAgent."
      demoHref="/docs/angular/langgraph/guides/streaming?mode=run"
      guideHref="/docs/choosing-an-adapter"
      guideLabel="Choose an adapter"
      paper="angular"
      formPolicy={getFormPolicy()}
    />
  );
}
