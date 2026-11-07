import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import { ClipPlayer } from '../ui/ClipPlayer';
import type { DemoClip } from '../../lib/demo-media';

/**
 * A recorded clip on a solutions page, shown after the code.
 *
 * Deliberately NOT the homepage `DemoShowcase`: that one is a tabbed switcher
 * with a play overlay that opens the live demo in a modal. Neither fits here —
 * there is one clip and no second runtime to switch between, and the live demo
 * opens on an empty thread rather than on the flow this clip is about, so a
 * "Launch live demo" button would promise something the destination does not
 * deliver. A link under the frame says the same thing honestly.
 *
 * No client JS: `autoPlay muted loop playsInline` is the whole behaviour, so
 * this stays a Server Component.
 */
export function SolutionDemoBlock({ clip }: { clip: DemoClip }) {
  return (
    <Section ariaLabelledBy="solution-demo-heading">
      <Container>
        <div className="sol-demo-wrap">
          <h2 id="solution-demo-heading" className="sol-demo-heading">
            The approval gate, in the product
          </h2>
          <p className="sol-demo-caption">{clip.caption}</p>

          <p className="sol-demo-note">
            Recorded from the{' '}
            <a
              href="https://demo.threadplane.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="sol-demo-note-link"
            >
              live demo
            </a>
            , which you can drive yourself.
          </p>
          <ClipPlayer clip={clip} />
        </div>
      </Container>
    </Section>
  );
}
