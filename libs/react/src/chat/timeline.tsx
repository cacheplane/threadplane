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
  /**
   * Adds a Replay button to each default row. It receives the row's `id`;
   * running anything from that checkpoint is the application's job.
   */
  readonly onReplay?: (id: string) => void;
  /** Adds a Fork button to each default row, in the same way. */
  readonly onFork?: (id: string) => void;
  /** Replaces the complete row; the owner supplies controls and accessibility. */
  readonly renderItem?: (
    item: TimelineItem,
    isSelected: boolean,
    index: number
  ) => ReactNode;
}

/**
 * A controlled view of supplied checkpoints, in their original order. With
 * `onReplay` or `onFork`, each row also offers that request beside its
 * selection button; neither selects the row or starts any work.
 */
export function Timeline({
  items,
  onSelect,
  selectedId,
  label = 'Checkpoints',
  className,
  onReplay,
  onFork,
  renderItem,
}: TimelineProps) {
  const actions = [
    { name: 'Replay', request: onReplay },
    { name: 'Fork', request: onFork },
  ].filter((action) => action.request !== undefined);
  return (
    <ol
      className={`tp-timeline${className ? ` ${className}` : ''}`}
      aria-label={label}
    >
      {items.map((item, index) => {
        const select = (
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
        );
        return (
          <li key={item.id} className="tp-timeline__item">
            {renderItem ? (
              renderItem(item, item.id === selectedId, index)
            ) : actions.length === 0 ? (
              select
            ) : (
              <div className="tp-timeline__row">
                {select}
                <span className="tp-timeline__actions">
                  {actions.map(({ name, request }) => (
                    <button
                      key={name}
                      type="button"
                      className="tp-timeline__action"
                      aria-label={`${name} from ${item.label}`}
                      disabled={item.disabled === true}
                      onClick={() => request?.(item.id)}
                    >
                      {name}
                    </button>
                  ))}
                </span>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
