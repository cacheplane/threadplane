/**
 * Geometry and copy for the homepage architecture diagram
 * (spec: docs/superpowers/specs/2026-09-07-enterprise-architecture-diagram-design.md).
 *
 * One table, three readers: the component draws it, the unit spec checks that
 * every rectangle lands on the 8px grid inside the view without overlapping,
 * and the e2e measures the rendered text against these same boxes.
 * Coordinates are viewBox units; the SVG scales with its container.
 *
 * The story is four columns, left to right: your users, your Angular
 * application with Threadplane as its UI layer, the two adapters, and your
 * agents — with a strip of model providers beneath. Every card links to the
 * docs page that backs its wording. Third-party products appear as examples
 * of a role, never as integrations the library claims.
 */

export const VIEW = { width: 1280, height: 640 } as const;
export const GRID = 8;
export const MAJOR = 40;
export const CARD_GAP = 40;
/** Left inset of card content. */
export const CARD_PAD = 24;
/** Baseline of a card's title row, below the card's top. */
export const TITLE_DY = 42;

export type LogoKey =
  | 'angular'
  | 'vercel'
  | 'google'
  | 'langgraph'
  | 'langchain'
  | 'agui'
  | 'bedrock'
  | 'azure'
  | 'microsoft'
  | 'mastra'
  | 'crewai'
  | 'pydantic'
  | 'openai'
  | 'anthropic';

/** Public paths of the marks the diagram is allowed to use (README under /logos). */
export const LOGOS: Readonly<Record<LogoKey, string>> = {
  angular: '/logos/surface/angular.svg',
  vercel: '/logos/surface/vercel.svg',
  google: '/logos/providers/google.svg',
  langgraph: '/logos/langgraph.svg',
  langchain: '/logos/langchain.svg',
  agui: '/logos/ag-ui.svg',
  bedrock: '/logos/providers/bedrock.svg',
  azure: '/logos/providers/azure.svg',
  microsoft: '/logos/runtimes/microsoft.svg',
  mastra: '/logos/runtimes/mastra.svg',
  crewai: '/logos/runtimes/crewai.svg',
  pydantic: '/logos/runtimes/pydantic.svg',
  openai: '/logos/providers/openai.svg',
  anthropic: '/logos/providers/anthropic.svg',
};

export type IconKey =
  | 'users'
  | 'chat'
  | 'pause'
  | 'branch'
  | 'sparkles'
  | 'wrench';

export interface Capability {
  readonly icon: IconKey;
  readonly label: string;
  readonly href: string;
}

export type Row =
  | { readonly kind: 'text'; readonly y: number; readonly text: string }
  | { readonly kind: 'mono'; readonly y: number; readonly text: string }
  /** Capability badges stacked vertically from `y`, 40 apart, each its own link. */
  | {
      readonly kind: 'caps';
      readonly y: number;
      readonly caps: readonly Capability[];
    }
  /** A mark badge with a label beside it, at an absolute x within the card. */
  | {
      readonly kind: 'badge';
      readonly x: number;
      readonly y: number;
      readonly mark: LogoKey;
      readonly label: string;
    }
  /** A banded list: one row per item, each with a left accent bar. */
  | {
      readonly kind: 'items';
      readonly y: number;
      readonly items: readonly string[];
      /** Vertical pitch between rows. */
      readonly step: number;
    }
  /** A row of mark badges with no labels. */
  | {
      readonly kind: 'marks';
      readonly y: number;
      readonly marks: readonly LogoKey[];
      readonly size: number;
      readonly step: number;
    };

export interface Card {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly title: string;
  /** Second title line (the adapter cards break their names over two lines). */
  readonly title2?: string;
  readonly href: string;
  /** A mark badge beside the title (40px), or an icon badge. */
  readonly mark?: LogoKey;
  readonly icon?: {
    readonly name: IconKey;
    readonly bg: string;
    readonly fg: string;
  };
  /** Pushes an icon card's icon and title down, to centre a short card's content. */
  readonly contentDy?: number;
  /** Right-aligned tag on the card's first line. */
  readonly tag?: string;
  readonly highlight?: boolean;
  readonly rows: readonly Row[];
}

export interface ColumnLabel {
  readonly x: number;
  readonly label: string;
}

export interface Arrow {
  readonly x1: number;
  readonly x2: number;
  readonly y: number;
}

export interface StripChip {
  readonly mark: LogoKey;
  readonly label: string;
}

export const COLUMNS: readonly ColumnLabel[] = [
  { x: 48, label: 'YOUR USERS' },
  { x: 288, label: 'YOUR ANGULAR APPLICATION' },
  { x: 744, label: 'ADAPTERS' },
  { x: 1008, label: 'YOUR AGENTS' },
];
export const COLUMN_LABEL_Y = 72;

export const CARDS: readonly Card[] = [
  {
    id: 'users',
    x: 48,
    y: 104,
    width: 176,
    height: 392,
    title: 'People',
    href: '/docs/angular/chat/getting-started/introduction',
    icon: { name: 'users', bg: '#fff3e0', fg: '#c2410c' },
    // The column's single node: its block is centred on the card, where its
    // outgoing arrow leaves.
    contentDy: 104,
    rows: [{ kind: 'text', y: 352, text: 'web · mobile' }],
  },
  {
    id: 'threadplane',
    x: 288,
    y: 104,
    width: 392,
    height: 392,
    title: 'Threadplane',
    href: '/docs/angular/chat/getting-started/introduction',
    tag: 'THE UI LAYER',
    highlight: true,
    rows: [
      {
        kind: 'caps',
        y: 224,
        caps: [
          { icon: 'chat', label: 'Chat', href: '/docs/angular/chat/components/chat' },
          {
            icon: 'pause',
            label: 'Approvals',
            href: '/docs/angular/langgraph/guides/interrupts',
          },
          {
            icon: 'branch',
            label: 'Threads',
            href: '/docs/angular/langgraph/guides/persistence',
          },
          {
            icon: 'sparkles',
            label: 'Generative UI',
            href: '/docs/angular/chat/guides/generative-ui',
          },
          {
            icon: 'wrench',
            label: 'Client tools',
            href: '/docs/angular/chat/guides/client-tools',
          },
        ],
      },
      { kind: 'badge', x: 524, y: 224, mark: 'google', label: 'A2UI' },
      { kind: 'badge', x: 524, y: 272, mark: 'vercel', label: 'json-render' },
      {
        kind: 'mono',
        y: 470,
        text: '@threadplane/chat',
      },
    ],
  },
  {
    id: 'langgraph-sdk',
    x: 744,
    y: 104,
    width: 200,
    height: 208,
    title: 'LangGraph',
    title2: 'SDK',
    href: '/docs/angular/langgraph/getting-started/introduction',
    mark: 'langgraph',
    tag: 'FIRST-CLASS',
    highlight: true,
    rows: [
      {
        kind: 'items',
        y: 212,
        step: 32,
        items: [
          'checkpoints · interrupts',
          'time travel · memory',
          'subgraphs · durable runs',
        ],
      },
    ],
  },
  {
    id: 'ag-ui',
    x: 744,
    y: 352,
    width: 200,
    height: 144,
    title: 'AG-UI',
    title2: 'protocol',
    href: '/docs/angular/ag-ui/getting-started/introduction',
    mark: 'agui',
    rows: [
      { kind: 'items', y: 468, step: 32, items: ['events · tools · state'] },
    ],
  },
  {
    id: 'langsmith',
    x: 1008,
    y: 104,
    width: 224,
    height: 208,
    title: 'LangSmith',
    href: '/docs/angular/langgraph/guides/deployment',
    mark: 'langchain',
    rows: [
      {
        kind: 'items',
        y: 212,
        step: 32,
        items: ['deploy · observe', 'traces · evals', 'or self-hosted'],
      },
    ],
  },
  {
    id: 'ag-ui-servers',
    x: 1008,
    y: 352,
    width: 224,
    height: 144,
    title: 'AG-UI servers',
    href: '/docs/angular/runtimes/getting-started/introduction',
    rows: [
      {
        kind: 'marks',
        y: 408,
        marks: ['crewai', 'mastra', 'microsoft', 'bedrock', 'pydantic'],
        size: 30,
        step: 34,
      },
      {
        kind: 'items',
        y: 468,
        step: 32,
        items: ['CrewAI · Mastra · Microsoft'],
      },
    ],
  },
];

/** Each arrow lands on the vertical centre of the card it enters. */
export const ARROWS: readonly Arrow[] = [
  { x1: 224, x2: 288, y: 300 },
  { x1: 680, x2: 744, y: 208 },
  { x1: 680, x2: 744, y: 424 },
  { x1: 944, x2: 1008, y: 208 },
  { x1: 944, x2: 1008, y: 424 },
];
/** The two-line caption between the adapter arrows. */
export const CONTRACT_CAPTION = {
  x: 712,
  y: 306,
  lines: ['one Agent', 'contract'],
} as const;

export const MODEL_STRIP = {
  label: 'ANY MODEL',
  labelY: 524,
  chipY: 556,
  x: 48,
  chips: [
    { mark: 'openai', label: 'OpenAI' },
    { mark: 'anthropic', label: 'Anthropic' },
    { mark: 'google', label: 'Google' },
    { mark: 'azure', label: 'Azure OpenAI' },
    { mark: 'bedrock', label: 'Amazon Bedrock' },
  ] as readonly StripChip[],
  caption: 'your choice',
} as const;

export const STRIP_CHIP_H = 36;
export const stripChipWidth = (label: string): number =>
  Math.round(label.length * 7.2) + 48;
export const STRIP_GAP = 12;

/** Every docs href the diagram links to, deduplicated, for the link-resolution spec. */
export function diagramHrefs(): readonly string[] {
  const out = new Set<string>();
  for (const c of CARDS) {
    out.add(c.href);
    for (const r of c.rows)
      if (r.kind === 'caps') for (const cap of r.caps) out.add(cap.href);
  }
  return [...out];
}
