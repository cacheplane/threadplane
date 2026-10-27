/**
 * Metadata for the two deployed demos, in one place.
 *
 * The demos are static Angular apps whose `index.html` cannot import this
 * module, so each one carries a copy of its title and description. The copy
 * here is the source of truth: `demo-meta.spec.ts` reads both `index.html`
 * files off disk and fails when they disagree, and the `/demo-card/*` routes
 * render the social cards from it.
 */
import { DEMOS, type DemoTarget } from './demos';

export const SOCIAL_CARD_PATH = '/social-card.png';
export const SOCIAL_CARD_SIZE = { width: 1200, height: 630 } as const;

export interface DemoMeta {
  key: DemoTarget['key'];
  /** `https://host`, no trailing slash. From the link registry so hrefs cannot drift. */
  origin: string;
  /** `<title>`, `og:title`, `twitter:title`. */
  title: string;
  /** `meta[name=description]`, `og:description`, `twitter:description`. */
  description: string;
  cardEyebrow: string;
  cardHeadlineLines: readonly string[];
  cardSubhead: string;
  /** Runtime pill on the card. */
  runtimeLabel: string;
  /** `og:image:alt` / `twitter:image:alt` — describes what the card shows. */
  cardAlt: string;
}

function originOf(key: DemoTarget['key']): string {
  const target = DEMOS.find((d) => d.key === key);
  if (!target) throw new Error(`No demo link registered for "${key}"`);
  return target.href.replace(/\/$/u, '');
}

export const DEMO_META: readonly DemoMeta[] = [
  {
    key: 'langgraph',
    origin: originOf('langgraph'),
    title: 'LangGraph chat demo — Threadplane',
    description:
      'Live Angular chat on LangGraph: streaming, durable threads, human approvals, tool progress, and generative UI. Embed, popup, and sidebar layouts.',
    cardEyebrow: 'LIVE DEMO',
    cardHeadlineLines: ['Angular chat', 'on LangGraph.'],
    cardSubhead:
      'Streaming, durable threads, human approvals, tool progress, and generative UI — running live.',
    runtimeLabel: 'LangGraph',
    cardAlt:
      'LangGraph chat demo — Threadplane. Beside the title, a browser frame at demo.threadplane.ai shows an agent proposing to delete three backups and pausing for Approve or Decline.',
  },
  {
    key: 'ag-ui',
    origin: originOf('ag-ui'),
    title: 'AG-UI itinerary demo — Threadplane',
    description:
      'Live Angular demo on an AG-UI backend: an agent plans a trip and edits a live itinerary and map while you watch. Streaming, client tools, and approvals.',
    cardEyebrow: 'LIVE DEMO',
    cardHeadlineLines: ['An agent that', 'edits the UI.'],
    cardSubhead:
      'Ask for a trip and the agent fills a live itinerary and map over AG-UI — streaming, client tools, approvals.',
    runtimeLabel: 'AG-UI',
    cardAlt:
      'AG-UI itinerary demo — Threadplane. Beside the title, a browser frame at ag-ui.threadplane.ai shows a trip request and three itinerary days the agent filled in.',
  },
];

export function demoMeta(key: DemoTarget['key']): DemoMeta {
  const meta = DEMO_META.find((m) => m.key === key);
  if (!meta) throw new Error(`No demo metadata for "${key}"`);
  return meta;
}

export const canonicalUrl = (meta: DemoMeta): string => `${meta.origin}/`;
export const socialCardUrl = (meta: DemoMeta): string => `${meta.origin}${SOCIAL_CARD_PATH}`;
