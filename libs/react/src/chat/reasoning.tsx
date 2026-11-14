'use client';
import { useId, useState } from 'react';
import type { MarkdownSnapshot } from '@threadplane/content/markdown';
import { Markdown } from '../markdown/markdown.js';

/** Presentation options for an application-owned reasoning document. */
export interface ReasoningProps {
  readonly snapshot: MarkdownSnapshot;
  readonly durationMs?: number;
  /** How many reasoning steps the document joins; more than one is named in the label. */
  readonly steps?: number;
  readonly label?: string;
  readonly defaultExpanded?: boolean;
  readonly className?: string;
}

/** Disclosure of backend-supplied reasoning, borrowing an owned Markdown snapshot. */
export function Reasoning({
  snapshot,
  durationMs,
  steps,
  label,
  defaultExpanded = false,
  className,
}: ReasoningProps) {
  const { generation, phase, content } = snapshot.document;
  const streaming = phase === 'streaming';
  const id = useId();
  const [choice, setChoice] = useState({
    generation,
    phase,
    expanded: null as boolean | null,
  });
  let current = choice;
  if (choice.generation !== generation || choice.phase !== phase) {
    current = {
      generation,
      phase,
      expanded:
        choice.generation !== generation || streaming ? null : choice.expanded,
    };
    // Reset before committing a replacement response; completion preserves choice.
    setChoice(current);
  }
  if (content.length === 0) return null;
  const expanded = current.expanded ?? (streaming || defaultExpanded);
  const several =
    steps !== undefined && Number.isFinite(steps) && steps > 1
      ? `${Math.floor(steps)} steps`
      : undefined;
  // An unknown duration is left out: "<1s" would read as fast, not unknown.
  const text =
    label ||
    (streaming
      ? 'Thinking…'
      : durationMs === undefined
      ? several
        ? `Thought in ${several}`
        : 'Show reasoning'
      : `Thought for ${formatDuration(durationMs)}${
          several ? ` · ${several}` : ''
        }`);
  return (
    <div className={['tp-reasoning', className].filter(Boolean).join(' ')}>
      <button
        id={`${id}-toggle`}
        type="button"
        className="tp-reasoning__toggle"
        aria-expanded={expanded}
        aria-controls={`${id}-body`}
        onClick={() => setChoice({ ...current, expanded: !expanded })}
      >
        <span aria-hidden="true">{expanded ? '▾' : '▸'}</span> {text}
      </button>
      <div
        id={`${id}-body`}
        role="region"
        aria-label="Reasoning"
        hidden={!expanded}
        className="tp-reasoning__body"
      >
        <Markdown snapshot={snapshot} />
      </div>
    </div>
  );
}

function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 1000) return '<1s';
  const seconds = Math.floor(milliseconds / 1000);
  return seconds < 60
    ? `${seconds}s`
    : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}
