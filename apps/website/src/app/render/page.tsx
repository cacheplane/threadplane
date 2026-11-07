import {
  LibraryLanding,
  type LibraryFeature,
} from '../../components/library/LibraryLanding';
import { RenderCodeShowcase } from '../../components/landing/render/RenderCodeShowcase';
import { createPageMetadata } from '../../lib/site-metadata';
import { SECTION_MEDIA } from '../../lib/section-media';
import { buildPanes } from '../../lib/build-panes';
import { getFormPolicy } from '../../lib/growth/form-policy';

export const metadata = createPageMetadata({
  title: 'Render \u2014 Threadplane',
  description:
    'Turn structured agent output into an interface built from components you own. Keep the visual language in your application and let the agent assemble the right surface.',
  pathname: '/render',
  type: 'website',
});

const FEATURES: LibraryFeature[] = [
  {
    id: 'schemas',
    title: 'A spec becomes a surface.',
    body: 'The agent emits structured JSON. Your application resolves the spec against a registry of components, so the result fits the interface around it.',
    points: [
      'Structured specifications across the boundary',
      'Components selected from your registry',
      'Design decisions owned by your team',
    ],
    illustration: 'components',
    takeaway: 'The agent assembles. Your components render.',
  },
  {
    id: 'state',
    title: 'More than a static card.',
    body: 'Connect rendered components to state and actions. Let a generated surface respond as the underlying data changes and people interact with it.',
    points: [
      'State bindings for the rendered surface',
      'Application-owned action handlers',
      'Composition with the rest of your UI',
    ],
    illustration: 'connections',
    takeaway: 'Structured output, connected to your application.',
  },
  {
    id: 'fallbacks',
    title: 'Plan for the unexpected.',
    body: 'Keep control when a spec arrives before a component is ready, or names something the registry cannot resolve. Handle those boundaries deliberately.',
    points: [
      'Registry boundaries you can inspect',
      'Framework-specific readiness and fallbacks',
      'Explicit integration and validation patterns',
    ],
    illustration: 'durable',
    takeaway: 'A clear boundary between a spec and your UI.',
  },
];

export default async function RenderPage() {
  const media = SECTION_MEDIA.libRender;
  const panes = await buildPanes(media, media.video?.url ?? '');
  return (
    <LibraryLanding
      name="Render"
      slug="render"
      headline={
        <>
          Your components.
          <br />
          Assembled by agents.
        </>
      }
      description="Turn structured agent output into an interface built from components you own. Keep the visual language in your application and let the agent assemble the right surface."
      reactDocs="/docs/react/render/guides/specs"
      angularDocs="/docs/angular/render/getting-started/introduction"
      features={FEATURES}
      panes={panes}
      code={<RenderCodeShowcase showIntroduction={false} />}
      technicalNote="These Angular examples show registry setup and rendering. React has a separate render integration. Use the framework guides for protocol support, including the scope of the React A2UI preview."
      demoHref="/docs/angular/render/guides/specs?mode=run"
      guideHref="/docs/angular/render/guides/registry"
      guideLabel="Explore the registry"
      paper="render"
      formPolicy={getFormPolicy()}
    />
  );
}
