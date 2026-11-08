import {
  LibraryLanding,
  type LibraryFeature,
} from '../../components/library/LibraryLanding';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'AG-UI \u2014 Threadplane',
  description:
    'Connect your interface to agents through AG-UI. Keep protocol details at the boundary, and build the experience around the work your users need to do.',
  pathname: '/ag-ui',
  type: 'website',
});

const FEATURES: LibraryFeature[] = [
  {
    id: 'backends',
    title: 'Keep your runtime.',
    body: 'AG-UI carries the events between your agent and your application. Connect a compatible backend without making its protocol the shape of your entire UI.',
    points: [
      'Streaming events across the boundary',
      'Tool activity and state updates',
      'A common contract for your interface',
    ],
    illustration: 'connections',
    takeaway: 'The protocol connects. Your product stays yours.',
  },
  {
    id: 'primitives',
    title: 'Make the work visible.',
    body: 'Turn agent events into a conversation people can understand. Show what is happening, what changed, and when a person needs to step in.',
    points: [
      'Messages and tool-call progress',
      'Shared state as the run advances',
      'Approval flows with compatible backends',
    ],
    illustration: 'reviewable',
    takeaway: 'Give people a clear place in the loop.',
  },
  {
    id: 'runtime-choice',
    title: 'Choose the right route.',
    body: 'Use the runtime that fits your system, from CrewAI and Mastra to Pydantic AI, Microsoft Agent Framework, and AWS Strands. Check the integration guide for the capabilities your backend exposes.',
    points: [
      'Your models and deployment environment',
      'Backend-owned persistence and history',
      'Native LangGraph when you need its thread API',
    ],
    illustration: 'components',
    takeaway: 'A shared protocol. Backend-specific capabilities.',
  },
];

export default async function AGUIPage() {
  const media = SECTION_MEDIA.libAgUi;
  const panes = await buildPanes(media, media.video?.url ?? '');
  return (
    <LibraryLanding
      name="AG-UI"
      slug="ag-ui"
      headline={
        <>
          Your runtime.
          <br />
          One conversation layer.
        </>
      }
      description="Connect your interface to agents through AG-UI. Keep protocol details at the boundary, and build the experience around the work your users need to do."
      reactDocs="/docs/react/ag-ui/guides/interrupts"
      angularDocs="/docs/angular/ag-ui/getting-started/quickstart"
      features={FEATURES}
      panes={panes}
      technicalNote="These Angular examples use the AG-UI adapter. React guides cover the source-build integration. Thread history and checkpoints depend on your backend; choose the native adapter for LangGraph thread APIs."
      demoHref="/docs/angular/ag-ui/guides/interrupts?mode=run"
      guideHref="/docs/choosing-an-adapter"
      guideLabel="Choose an adapter"
      paper="overview"
      formPolicy={getFormPolicy()}
    />
  );
}
