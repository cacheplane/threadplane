'use client';

import type { ReactNode } from 'react';

/** Selectable checkpoint metadata with an ID, display label, optional description, and disabled state. */
export interface TimelineItem {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}

/** Supplies ordered checkpoints, controlled selection, and an optional complete-row rendering override. */
export interface TimelineProps {
  readonly items: readonly TimelineItem[];
  readonly onSelect: (id: string) => void;
  readonly selectedId?: string | null;
  readonly label?: string;
  readonly className?: string;
  /** Replaces the complete row; the owner supplies controls and accessibility. */
  readonly renderItem?: (
    item: TimelineItem,
    isSelected: boolean,
    index: number
  ) => ReactNode;
}

/** A controlled view of supplied checkpoints, in their original order. */
export function Timeline({
  items,
  onSelect,
  selectedId,
  label = 'Checkpoints',
  className,
  renderItem,
}: TimelineProps) {
  return (
    <ol
      className={`tp-timeline${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {items.map((item, index) => (
        <li key={item.id} className="tp-timeline__item">
          {renderItem ? (
            renderItem(item, item.id === selectedId, index)
          ) : (
            <button
              type="button"
              className="tp-timeline__button"
              aria-current={item.id === selectedId ? 'true' : undefined}
              disabled={item.disabled === true}
              onClick={() => onSelect(item.id)}
            >
              <span className="tp-timeline__marker" aria-hidden="true">
                {index + 1}
              </span>
              <span className="tp-timeline__content">
                <span className="tp-timeline__label">{item.label}</span>
                {item.description !== undefined && (
                  <span className="tp-timeline__description">
                    {item.description}
                  </span>
                )}
              </span>
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}
