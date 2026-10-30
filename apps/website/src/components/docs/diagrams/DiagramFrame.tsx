import type { ReactNode } from 'react';
import { ExpandableDiagram } from './ExpandableDiagram';

interface DiagramFrameProps {
  /**
   * Unique per rendered diagram; namespaces the SVG defs ids (`{slug}-dots`, `{slug}-arrow`).
   * Must be unique per rendered diagram INSTANCE on a page — a duplicate slug cross-wires
   * `url(#…)` defs document-wide (first match wins).
   */
  slug: string;
  viewWidth: number;
  viewHeight: number;
  /** Accessible one-sentence description of what the diagram shows. */
  label: string;
  caption?: string;
  /** Complete reading order and relationships, available without interpreting SVG. */
  description?: string;
  /**
   * Marketing pages render the same SVG larger; compact cards render it small with a bigger type
   * ramp. Compact compositions author at a ~320 viewBox with the compact type ramp (eyebrow 10 /
   * mono title 13.5 / sans title 12 / meta 11 / pill 10.5, viewBox units) — see DiagramNode's note
   * for the shared baseline offsets; rendered width is capped at 420px regardless of card size.
   * Compact rhythm: 18px inter-node gaps, edges stop 4px short of the node they arrive at
   * (arrowhead fills the rest), 16px outer margins, and a uniform viewHeight of 240 across the
   * homepage concept-card set — so every card in that set is the same height regardless of
   * viewWidth or node count. Second rhythm, for node↔pill gaps: 12px (segment lengths flex to
   * fit; pills abut their segments).
   */
  scale?: 'docs' | 'marketing' | 'compact';
  children: ReactNode;
}

/**
 * These are React Server Components by design — no hooks/context, which is
 * why `slug` is threaded explicitly through every primitive instead of being
 * derived implicitly.
 */
export function DiagramFrame({
  slug,
  viewWidth,
  viewHeight,
  label,
  caption,
  description,
  scale = 'docs',
  children,
}: DiagramFrameProps) {
  const diagram = (
      <svg
        className="tp-diagram-svg"
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        role="img"
        aria-label={label}
      >
        <defs>
          <pattern id={`${slug}-dots`} width="16" height="16" patternUnits="userSpaceOnUse">
            <circle className="tp-diagram-dot" cx="1" cy="1" r="1" />
          </pattern>
          <marker
            id={`${slug}-arrow`}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              className="tp-diagram-arrowhead"
              d="M1 1 L7 4 L1 7"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
        </defs>
        <rect width={viewWidth} height={viewHeight} rx="10" fill={`url(#${slug}-dots)`} />
        {children}
      </svg>
  );
  if (scale === 'docs') {
    return <ExpandableDiagram label={label} caption={caption} description={description}>{diagram}</ExpandableDiagram>;
  }
  return (
    <figure className="tp-diagram-figure" data-scale={scale}>
      {diagram}
      {caption ? <figcaption className="tp-diagram-caption">{caption}</figcaption> : null}
    </figure>
  );
}
