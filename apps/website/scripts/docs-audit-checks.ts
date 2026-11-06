/** The cross-framework learning journey exercised without starting agents or runtimes. */
export const DOCS_AUDIT_ROUTES: readonly {
  path: string;
  kinds?: readonly string[];
  video?: boolean;
}[] = [
  {
    path: '/docs/angular/langgraph/getting-started/introduction',
    kinds: ['architecture'],
  },
  {
    path: '/docs/angular/langgraph/concepts/conversation-turns',
    kinds: ['architecture', 'sequence', 'state'],
    video: true,
  },
  {
    path: '/docs/angular/langgraph/guides/streaming',
    kinds: ['sequence'],
    video: true,
  },
  { path: '/docs/angular/langgraph/guides/persistence', kinds: ['erd'], video: true },
  { path: '/docs/angular/langgraph/guides/interrupts', kinds: ['state'] },
  {
    path: '/docs/angular/langgraph/concepts/state-management',
    kinds: ['architecture'],
  },
  { path: '/docs/angular/chat/guides/client-tools', kinds: ['flow'], video: true },
  { path: '/docs/angular/ag-ui/guides/client-tools', kinds: ['flow'] },
  { path: '/docs/angular/render/getting-started/introduction' },
  { path: '/docs/angular/render/concepts/json-render-vs-a2ui' },
  { path: '/docs/angular/render/guides/specs', video: true },
  { path: '/docs/angular/runtimes/getting-started/introduction' },
  { path: '/docs/angular/chat/migrations/upgrading' },
  { path: '/docs/react/langgraph/guides/streaming', video: true },
  { path: '/docs/react/langgraph/guides/persistence', video: true },
  { path: '/docs/react/chat/guides/client-tools', video: true },
  { path: '/docs/react/render/guides/specs', video: true },
  { path: '/docs/react/langgraph/guides/interrupts' },
  { path: '/docs/react/ag-ui/guides/client-tools' },
];

/** Suppress telemetry without sending it; all other non-read requests fail the audit. */
export function requestDisposition(
  method: string,
  value: string,
  origin: string
): 'allow' | 'analytics' | 'reject' {
  if (['GET', 'HEAD'].includes(method.toUpperCase())) return 'allow';
  const url = new URL(value);
  return url.origin === origin &&
    (url.pathname.startsWith('/ingest/') ||
      url.pathname === '/api/growth/collect/v1/website')
    ? 'analytics'
    : 'reject';
}

/** A redirected document cannot silently change the artifact under inspection. */
export function navigationIssue(
  origin: string,
  value: string
): string | undefined {
  const url = new URL(value);
  return url.origin === origin
    ? undefined
    : `Navigation left the audited origin: ${url.origin}${url.pathname}`;
}

export interface AuditBox {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface AuditGeometry {
  viewportWidth: number;
  documentWidth: number;
  fontsLoaded: boolean;
  canvas: AuditBox;
  nodes: { id: string; box: AuditBox }[];
  texts: { text: string; node?: string; box: AuditBox }[];
}
const contains = (outer: AuditBox, inner: AuditBox) =>
  inner.x >= outer.x - 2 &&
  inner.y >= outer.y - 2 &&
  inner.x + inner.width <= outer.x + outer.width + 2 &&
  inner.y + inner.height <= outer.y + outer.height + 2;
const overlaps = (a: AuditBox, b: AuditBox) =>
  Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > 2 &&
  Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > 2;

/** Browser-measured SVG geometry; phone scrolling is valid, clipping and fallback fonts are not. */
export function geometryIssues(value: AuditGeometry): string[] {
  const issues: string[] = [];
  if (!value.fontsLoaded) issues.push('Required diagram font did not load');
  if (value.documentWidth > value.viewportWidth + 1)
    issues.push('Document overflows the viewport');
  if (!value.canvas.width || !value.canvas.height || !value.texts.length)
    issues.push('Empty diagram geometry');
  for (const [index, node] of value.nodes.entries()) {
    if (!contains(value.canvas, node.box))
      issues.push(`Node outside canvas: ${node.id}`);
    for (const other of value.nodes.slice(index + 1))
      if (overlaps(node.box, other.box))
        issues.push(`Nodes overlap: ${node.id} / ${other.id}`);
  }
  for (const [index, text] of value.texts.entries()) {
    if (!contains(value.canvas, text.box))
      issues.push(`Text outside canvas: ${text.text}`);
    const node = value.nodes.find((candidate) => candidate.id === text.node);
    if (node && !contains(node.box, text.box))
      issues.push(`Text outside node: ${text.text}`);
    for (const other of value.texts.slice(index + 1))
      if (overlaps(text.box, other.box))
        issues.push(`Text overlaps: ${text.text} / ${other.text}`);
  }
  return issues;
}
