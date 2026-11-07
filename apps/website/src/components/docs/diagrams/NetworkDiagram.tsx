import type { CSSProperties } from 'react';
import { ExpandableDiagram } from './ExpandableDiagram';
import {
  nodeMetrics,
  sequenceLayout,
  validateDiagram,
  type DiagramPoint,
  type NetworkNode,
  type TeachingDiagram,
} from './diagram-model';

function Node({ node }: { node: NetworkNode }) {
  const metrics = nodeMetrics(node);
  return (
    <g
      className="tp-network-node"
      data-node-id={node.id}
      data-accent={node.accent || undefined}
      transform={`translate(${node.x} ${node.y})`}
    >
      <rect width={node.width} height={metrics.height} rx="10" />
      <text className="tp-network-title" x="16" y="28">
        {metrics.titles.map((line, i) => (
          <tspan key={i} x="16" dy={i ? 20 : 0}>
            {line}
          </tspan>
        ))}
      </text>
      {metrics.details.length > 0 && (
        <text className="tp-network-detail" x="16" y={metrics.detailY}>
          {metrics.details.map((line, i) => (
            <tspan key={i} x="16" dy={i ? 18 : 0}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

function Connection({
  points,
  dashed,
  label,
}: {
  points: readonly DiagramPoint[];
  dashed?: boolean;
  label?: { x: number; y: number; lines: readonly string[] };
}) {
  const end = points.at(-1),
    before = points.at(-2);
  if (!end || !before) throw new Error('A connection requires two points');
  const angle = Math.atan2(end[1] - before[1], end[0] - before[0]);
  const arrow = [
    end,
    [
      end[0] - 8 * Math.cos(angle - Math.PI / 6),
      end[1] - 8 * Math.sin(angle - Math.PI / 6),
    ],
    [
      end[0] - 8 * Math.cos(angle + Math.PI / 6),
      end[1] - 8 * Math.sin(angle + Math.PI / 6),
    ],
  ];
  return (
    <g className="tp-network-connection" data-return={dashed || undefined}>
      <polyline points={points.map((p) => p.join(',')).join(' ')} />
      <polygon points={arrow.map((p) => p.join(',')).join(' ')} />
      {label && (
        <text
          className="tp-network-edge-label"
          x={label.x}
          y={label.y}
          textAnchor="middle"
        >
          {label.lines.map((line, i) => (
            <tspan key={i} x={label.x} dy={i ? 20 : 0}>
              {line}
            </tspan>
          ))}
        </text>
      )}
    </g>
  );
}

/** Static SVG and text render on the server; only the existing expansion frame is interactive. */
export function NetworkDiagram({
  definition,
}: {
  definition: TeachingDiagram;
}) {
  validateDiagram(definition);
  const sequence =
    definition.kind === 'sequence' ? sequenceLayout(definition) : undefined;
  const width =
    sequence?.width ?? (definition.kind !== 'sequence' ? definition.width : 0);
  const height =
    sequence?.height ??
    (definition.kind !== 'sequence' ? definition.height : 0);
  return (
    <ExpandableDiagram
      kind={definition.kind}
      label={definition.title}
      caption={definition.caption}
      description={definition.description}
    >
      <svg
        className="tp-diagram-svg tp-network-diagram"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        style={{ '--network-width': `${width}px` } as CSSProperties}
        role="img"
        aria-label={definition.title}
      >
        {definition.kind !== 'sequence' ? (
          <>
            {definition.groups?.map((group) => (
              <g key={group.label} className="tp-network-group">
                <rect
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  rx="14"
                />
                <text x={group.x + 16} y={group.y + 27}>
                  {group.label}
                </text>
              </g>
            ))}
            {definition.edges.map((edge, i) => (
              <Connection
                key={i}
                points={edge.points}
                dashed={edge.dashed}
                label={
                  edge.label
                    ? { ...edge.label, lines: [edge.label.text] }
                    : undefined
                }
              />
            ))}
            {definition.nodes.map((node) => (
              <Node key={node.id} node={node} />
            ))}
          </>
        ) : (
          sequence && (
            <>
              {sequence.nodes.map((node) => (
                <line
                  key={node.id}
                  className="tp-network-lifeline"
                  x1={node.x + node.width / 2}
                  x2={node.x + node.width / 2}
                  y1={node.y + nodeMetrics(node).height}
                  y2={height - 16}
                />
              ))}
              {sequence.messages.map((message, i) => (
                <Connection
                  key={i}
                  points={message.points}
                  dashed={message.dashed}
                  label={{
                    x: message.x,
                    y: message.y - 12 - (message.lines.length - 1) * 20,
                    lines: message.lines,
                  }}
                />
              ))}
              {sequence.nodes.map((node) => (
                <Node key={node.id} node={node} />
              ))}
            </>
          )
        )}
      </svg>
    </ExpandableDiagram>
  );
}
