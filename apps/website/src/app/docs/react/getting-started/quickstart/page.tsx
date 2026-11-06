import type { Metadata } from 'next';
import Link from 'next/link';
import { Container } from '../../../../../components/ui/Container';
import { Section } from '../../../../../components/ui/Section';
import { Eyebrow } from '../../../../../components/ui/Eyebrow';

export const metadata: Metadata = {
  title: 'React quickstart — coming soon',
  robots: { index: false, follow: true },
};

export default function ReactQuickstartPage() {
  return (
    <Section ariaLabelledBy="react-quickstart-heading">
      <Container>
        <Eyebrow tone="accent" className="hero-eyebrow">Coming soon</Eyebrow>
        <h1 id="react-quickstart-heading" className="hero-heading">React quickstart</h1>
        <p className="hero-subhead">We’re working on React support. The React quickstart will be available here when it lands.</p>
        <Link className="hero-text-link" href="/docs/langgraph/getting-started/quickstart">Explore the Angular quickstart →</Link>
      </Container>
    </Section>
  );
}
