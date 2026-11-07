/** Small, author-controlled teaching diagrams. Coordinates are natural CSS pixels. */
export type DiagramPoint = readonly [number, number];
interface DiagramText {
  readonly title: string;
  readonly caption: string;
  readonly description: string;
}
export interface NetworkNode {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly title: string;
  readonly detail?: string;
  readonly accent?: boolean;
}
export interface NetworkEdge {
  readonly from: string;
  readonly to: string;
  readonly points: readonly DiagramPoint[];
  readonly dashed?: boolean;
  readonly label?: {
    readonly text: string;
    readonly x: number;
    readonly y: number;
  };
}
export interface NetworkDefinition extends DiagramText {
  readonly kind: 'architecture' | 'flow';
  readonly width: number;
  readonly height: number;
  readonly nodes: readonly NetworkNode[];
  readonly edges: readonly NetworkEdge[];
  readonly groups?: readonly {
    readonly label: string;
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  }[];
}
export interface SequenceDefinition extends DiagramText {
  readonly kind: 'sequence';
  readonly participants: readonly {
    readonly id: string;
    readonly title: string;
  }[];
  readonly messages: readonly {
    readonly from: string;
    readonly to: string;
    readonly label: string;
    readonly dashed?: boolean;
  }[];
}
export type TeachingDiagram = NetworkDefinition | SequenceDefinition;

/** Wrap prose and long identifiers without relying on SVG text clipping. */
export function wrapLabel(value: string, limit: number): string[] {
  if (!Number.isInteger(limit) || limit < 1)
    throw new Error('Invalid label width');
  const lines: string[] = [];
  let line = '';
  for (const word of value.trim().split(/\s+/)) {
    if (line && line.length + word.length + 1 > limit) {
      lines.push(line);
      line = '';
    }
    let rest = word;
    while (rest.length > limit) {
      lines.push(rest.slice(0, limit));
      rest = rest.slice(limit);
    }
    line = line ? `${line} ${rest}` : rest;
  }
  if (line) lines.push(line);
  return lines;
}

/** Keep padding and line heights identical across all graph and participant cards. */
export function nodeMetrics(node: NetworkNode) {
  if (!Number.isFinite(node.width) || node.width < 160)
    throw new Error('Invalid node bounds');
  const titles = wrapLabel(node.title, Math.floor((node.width - 32) / 9));
  const details = node.detail
    ? wrapLabel(node.detail, Math.floor((node.width - 32) / 7.5))
    : [];
  const detailY = 28 + titles.length * 20;
  const height = Math.max(76, 32 + titles.length * 20 + details.length * 18);
  return { titles, details, detailY, height };
}

/** Participant columns are stable; message rows grow when their labels wrap. */
export function sequenceLayout(definition: SequenceDefinition) {
  const nodes: NetworkNode[] = definition.participants.map((p, index) => ({
    ...p,
    x: 10 + index * 190,
    y: 16,
    width: 170,
  }));
  const center = (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) throw new Error(`Unknown participant reference: ${id}`);
    return node.x + node.width / 2;
  };
  const headerBottom = Math.max(
    0,
    ...nodes.map((n) => n.y + nodeMetrics(n).height)
  );
  let rowTop = headerBottom + 20;
  const messages = definition.messages.map((message, index) => {
    const start = center(message.from),
      end = center(message.to);
    const lines = wrapLabel(
      `${index + 1}. ${message.label}`,
      Math.max(12, Math.floor((Math.abs(end - start) - 24) / 8))
    );
    const y = rowTop + lines.length * 20 + 16;
    const result = {
      ...message,
      lines,
      y,
      x: (start + end) / 2,
      points: [
        [start, y],
        [end, y],
      ] as readonly DiagramPoint[],
    };
    rowTop = y + 40;
    return result;
  });
  return {
    nodes,
    messages,
    headerBottom,
    width: 190 * nodes.length,
    height: rowTop + 16,
  };
}

/** Fail malformed definitions before they reach a reader. Browser checks verify actual font geometry. */
export function validateDiagram(definition: TeachingDiagram): void {
  if (
    [definition.title, definition.caption, definition.description].some(
      (v) => !v.trim()
    )
  )
    throw new Error('Diagram text is required');
  const items =
    definition.kind === 'sequence' ? definition.participants : definition.nodes;
  if (items.length < 2) throw new Error('A diagram needs at least two nodes');
  const ids = new Set<string>();
  for (const item of items) {
    if (!item.id || ids.has(item.id))
      throw new Error('Duplicate or empty node identity');
    if (!item.title.trim()) throw new Error('Node title is required');
    ids.add(item.id);
  }
  const connections =
    definition.kind === 'sequence' ? definition.messages : definition.edges;
  if (!connections.length) throw new Error('A diagram needs connections');
  for (const edge of connections) {
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to)
      throw new Error('Invalid connection reference');
  }
  if (definition.kind === 'sequence') {
    if (definition.participants.length > 3)
      throw new Error('Split sequences with more than three participants');
    if (definition.messages.some((m) => !m.label.trim()))
      throw new Error('Message label is required');
    sequenceLayout(definition);
    return;
  }
  const { width, height } = definition;
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    width > 680 ||
    height <= 0
  )
    throw new Error('Invalid diagram bounds');
  const inside = (x: number, y: number) =>
    Number.isFinite(x) &&
    Number.isFinite(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= width &&
    y <= height;
  for (const node of definition.nodes) {
    if (
      !inside(node.x, node.y) ||
      !inside(node.x + node.width, node.y + nodeMetrics(node).height)
    )
      throw new Error(`Node outside bounds: ${node.id}`);
  }
  for (const group of definition.groups ?? []) {
    if (
      !group.label.trim() ||
      group.width <= 0 ||
      group.height <= 0 ||
      !inside(group.x, group.y) ||
      !inside(group.x + group.width, group.y + group.height)
    )
      throw new Error('Group outside bounds');
  }
  for (const edge of definition.edges) {
    if (edge.points.length < 2 || edge.points.some(([x, y]) => !inside(x, y)))
      throw new Error('Connection outside bounds');
    const last = edge.points.at(-1),
      before = edge.points.at(-2);
    if (!last || !before) throw new Error('Connection needs two points');
    if (last[0] === before[0] && last[1] === before[1])
      throw new Error('Connection needs a direction');
    if (
      edge.label &&
      (!edge.label.text.trim() || !inside(edge.label.x, edge.label.y))
    )
      throw new Error('Label outside bounds');
  }
}
