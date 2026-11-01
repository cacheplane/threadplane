import type { ComponentType } from 'react';
import {
  BarChart3,
  BookOpen,
  Braces,
  Building2,
  Compass,
  Lightbulb,
  Map as MapIcon,
  MessageSquare,
  Newspaper,
  Play,
  Rocket,
  ShieldCheck,
  Users,
} from 'lucide-react';
import type { LibraryId } from '../../lib/docs-config';
import { DEMOS, demoCtaSuffix } from '../../lib/demos';

export type NavIcon = ComponentType<{ size?: number; 'aria-hidden'?: boolean }>;

export interface NavItem {
  readonly label: string;
  /** One whole literal — never assembled from interpolated fragments, so the
   *  rendered-copy scan in lib/public-copy.spec.ts can see all of it. */
  readonly description: string;
  readonly href: string;
  readonly external?: true;
  /** Renders the library's own mark instead of `icon`. */
  readonly library?: LibraryId;
  readonly icon?: NavIcon;
  /** Analytics suffix. Prefixed with `nav_` or `mobile_nav_` at the call site. */
  readonly ctaId: string;
}

export interface NavColumn {
  readonly heading?: string;
  readonly items: readonly NavItem[];
}

export interface NavPanel {
  readonly columns: readonly NavColumn[];
  readonly footer?: NavItem & { readonly lead: string };
}

export type NavTrigger =
  | { readonly kind: 'link'; readonly id: string; readonly label: string; readonly href: string; readonly ctaId: string }
  | { readonly kind: 'panel'; readonly id: string; readonly label: string; readonly panel: NavPanel };

const LIBRARIES: NavPanel = {
  columns: [
    {
      items: [
        {
          label: '@threadplane/langgraph',
          description: 'LangGraph and LangChain agents in Angular',
          href: '/langgraph',
          library: 'langgraph',
          ctaId: 'libraries_langgraph',
        },
        {
          label: '@threadplane/ag-ui',
          description: 'The AG-UI protocol — CrewAI, Mastra, MAF',
          href: '/ag-ui',
          library: 'ag-ui',
          ctaId: 'libraries_ag_ui',
        },
        {
          label: '@threadplane/chat',
          description: 'Chat, timeline, and thread primitives',
          href: '/chat',
          library: 'chat',
          ctaId: 'libraries_chat',
        },
        {
          label: '@threadplane/render',
          description: 'Generative UI from agent output',
          href: '/render',
          library: 'render',
          ctaId: 'libraries_render',
        },
      ],
    },
  ],
  footer: {
    lead: 'Not sure which one?',
    label: 'Choosing an adapter',
    description: 'The four libraries side by side',
    href: '/docs/choosing-an-adapter',
    icon: Compass,
    ctaId: 'libraries_choosing_an_adapter',
  },
};

const DOCS: NavPanel = {
  columns: [
    {
      heading: 'Start here',
      items: [
        {
          label: 'Documentation',
          description: 'Every library, one shell',
          href: '/docs',
          icon: BookOpen,
          ctaId: 'docs_documentation',
        },
        {
          label: 'Quick start',
          description: 'An agent on screen in ten minutes',
          href: '/docs/langgraph/getting-started/quickstart',
          icon: Rocket,
          ctaId: 'docs_quick_start',
        },
        {
          label: 'Choosing an adapter',
          description: 'The four libraries side by side',
          href: '/docs/choosing-an-adapter',
          icon: Compass,
          ctaId: 'docs_choosing_an_adapter',
        },
      ],
    },
    {
      heading: 'Go deeper',
      items: [
        {
          label: 'Guides',
          description: 'Streaming, persistence, interrupts, memory',
          href: '/docs/langgraph/guides/streaming',
          icon: MapIcon,
          ctaId: 'docs_guides',
        },
        {
          label: 'Concepts',
          description: 'The agent contract, signals, and state',
          href: '/docs/langgraph/concepts/agent-contract',
          icon: Lightbulb,
          ctaId: 'docs_concepts',
        },
        {
          label: 'API reference',
          description: 'injectAgent, provideAgent, transports',
          href: '/docs/api',
          icon: Braces,
          ctaId: 'docs_api_reference',
        },
      ],
    },
    {
      heading: 'See it running',
      // Derived from DEMOS so the nav, the footer, and the mobile stack cannot
      // disagree about where a demo lives.
      items: DEMOS.map((demo) => ({
        label: demo.label,
        description: new URL(demo.href).host,
        href: demo.href,
        external: true as const,
        icon: Play,
        ctaId: `docs_demo_${demoCtaSuffix(demo.key)}`,
      })),
    },
  ],
};

const SOLUTIONS: NavPanel = {
  columns: [
    {
      heading: 'Use cases',
      items: [
        {
          label: 'Customer support',
          description: 'Deflection with a human in the loop',
          href: '/solutions/customer-support',
          icon: MessageSquare,
          ctaId: 'solutions_customer_support',
        },
        {
          label: 'Analytics',
          description: 'Conversational data exploration',
          href: '/solutions/analytics',
          icon: BarChart3,
          ctaId: 'solutions_analytics',
        },
        {
          label: 'Compliance',
          description: 'Auditable, approval-gated agents',
          href: '/solutions/compliance',
          icon: ShieldCheck,
          ctaId: 'solutions_compliance',
        },
      ],
    },
    {
      heading: 'Company',
      items: [
        {
          label: 'Pilot to Prod',
          description: 'How a pilot becomes a shipped surface',
          href: '/pilot-to-prod',
          icon: Building2,
          ctaId: 'solutions_pilot_to_prod',
        },
        {
          label: 'Blog',
          description: 'Engineering notes and release write-ups',
          href: '/blog',
          icon: Newspaper,
          ctaId: 'solutions_blog',
        },
        {
          label: 'About',
          description: 'Who is behind Threadplane',
          href: '/about',
          icon: Users,
          ctaId: 'solutions_about',
        },
      ],
    },
  ],
};

export const NAV_TRIGGERS: readonly NavTrigger[] = [
  { kind: 'panel', id: 'libraries', label: 'Libraries', panel: LIBRARIES },
  { kind: 'panel', id: 'docs', label: 'Docs', panel: DOCS },
  { kind: 'panel', id: 'solutions', label: 'Solutions', panel: SOLUTIONS },
  { kind: 'link', id: 'pricing', label: 'Pricing', href: '/pricing', ctaId: 'pricing' },
];

/** Every destination in the nav, flattened — for tests and for analytics audits. */
export function navItems(): readonly NavItem[] {
  return NAV_TRIGGERS.flatMap((trigger) => {
    if (trigger.kind === 'link') {
      return [
        {
          label: trigger.label,
          description: trigger.label,
          href: trigger.href,
          ctaId: trigger.ctaId,
        } satisfies NavItem,
      ];
    }
    const items = trigger.panel.columns.flatMap((column) => column.items);
    return trigger.panel.footer ? [...items, trigger.panel.footer] : items;
  });
}
