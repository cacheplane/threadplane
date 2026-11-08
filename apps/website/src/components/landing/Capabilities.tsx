import Link from 'next/link';
import { Container } from '../ui/Container';
import { Section } from '../ui/Section';
import {
  CapabilityIllustration,
  type Capability,
} from './CapabilityIllustration';

const capabilities: ReadonlyArray<{
  id: Capability;
  title: string;
  lead: string;
  description: string;
  link: string;
  href: string;
}> = [
  {
    id: 'persistent',
    title: 'Persistent.',
    lead: 'Keep the conversation.',
    description:
      'Return to saved threads with their messages, tools, and context intact.',
    link: 'Explore saved threads',
    href: '/docs/langgraph/guides/persistence',
  },
  {
    id: 'durable',
    title: 'Durable.',
    lead: 'Keep the progress.',
    description:
      'Bring checkpointed progress from your agent backend into the experience.',
    link: 'Understand checkpoints',
    href: '/docs/langgraph/guides/persistence#choosing-a-checkpointer',
  },
  {
    id: 'visible',
    title: 'Visible.',
    lead: 'Show the work.',
    description:
      'Make tool calls, progress, and results part of the conversation.',
    link: 'See tool-call rendering',
    href: '/docs/chat/components/chat-tool-calls',
  },
  {
    id: 'reviewable',
    title: 'Reviewable.',
    lead: 'Make room for a decision.',
    description:
      'Let people approve or redirect an agent before the next action.',
    link: 'Explore human approval',
    href: '/docs/langgraph/guides/interrupts',
  },
  {
    id: 'resumable',
    title: 'Resumable.',
    lead: 'Pick up where you left off.',
    description:
      'Continue a paused thread with the context your agent retained.',
    link: 'Explore run recovery',
    href: '/docs/langgraph/guides/persistence#checkpoint-recovery',
  },
];

export function Capabilities() {
  return (
    <Section
      id="capabilities"
      ariaLabelledBy="capabilities-heading"
      className="capabilities"
    >
      <Container>
        <div className="capabilities-intro">
          <h2 id="capabilities-heading">Agent work, carried through.</h2>
          <p>
            From the first message to the final approval, every step stays
            connected.
          </p>
        </div>
        <div className="capabilities-grid">
          {capabilities.map(({ id, title, lead, description, link, href }) => (
            <article
              key={id}
              id={`capability-${id}`}
              className="capability-card"
              aria-labelledby={`capability-${id}-heading`}
            >
              <div className="capability-copy">
                <h3 id={`capability-${id}-heading`}>{title}</h3>
                <p>
                  <strong>{lead}</strong>
                  {description}
                </p>
                <Link href={href} className="capability-link">
                  {link}
                  <span aria-hidden="true">›</span>
                </Link>
              </div>
              <CapabilityIllustration capability={id} />
            </article>
          ))}
        </div>
      </Container>
    </Section>
  );
}
