'use client';

import { useEffect, useRef, type PointerEvent } from 'react';

export interface WorkbenchSeparatorProps {
  label: string;
  orientation: 'vertical' | 'horizontal';
  value: number;
  min: number;
  max: number;
  step: number;
  defaultValue: number;
  onChange: (value: number, persist: boolean) => void;
  valueFromPointer: (event: PointerEvent<HTMLDivElement>) => number;
  className?: string;
}

interface Drag {
  pointerId: number;
  element: HTMLDivElement;
  value: number;
  changed: boolean;
}

function releaseCapture(drag: Drag) {
  try {
    drag.element.releasePointerCapture?.(drag.pointerId);
  } catch {
    // A canceled pointer may already have lost its capture.
  }
}

export function WorkbenchSeparator({
  label,
  orientation,
  value,
  min,
  max,
  step,
  defaultValue,
  onChange,
  valueFromPointer,
  className,
}: WorkbenchSeparatorProps) {
  const active = useRef<Drag | null>(null);
  const bounded = (next: number) => Math.min(max, Math.max(min, next));

  useEffect(
    () => () => {
      const drag = active.current;
      active.current = null;
      if (drag) releaseCapture(drag);
    },
    []
  );

  const finish = (event: PointerEvent<HTMLDivElement>) => {
    const drag = active.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    active.current = null;
    releaseCapture(drag);
    if (drag.changed) onChange(drag.value, true);
  };

  return (
    <div
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      tabIndex={0}
      className={['tp-learn-separator', className].filter(Boolean).join(' ')}
      onKeyDown={(event) => {
        const decrease = orientation === 'vertical' ? 'ArrowLeft' : 'ArrowUp';
        const increase =
          orientation === 'vertical' ? 'ArrowRight' : 'ArrowDown';
        if (
          event.key !== decrease &&
          event.key !== increase &&
          event.key !== 'Home'
        )
          return;
        event.preventDefault();
        onChange(
          bounded(
            event.key === 'Home'
              ? defaultValue
              : value + (event.key === increase ? step : -step)
          ),
          true
        );
      }}
      onDoubleClick={() => onChange(bounded(defaultValue), true)}
      onPointerDown={(event) => {
        if (event.button !== 0 || active.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        active.current = {
          pointerId: event.pointerId,
          element: event.currentTarget,
          value,
          changed: false,
        };
        try {
          event.currentTarget.setPointerCapture?.(event.pointerId);
        } catch {
          active.current = null;
        }
      }}
      onPointerMove={(event) => {
        const drag = active.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const next = valueFromPointer(event);
        if (!Number.isFinite(next)) return;
        drag.value = bounded(next);
        drag.changed = true;
        onChange(drag.value, false);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <span aria-hidden="true" />
    </div>
  );
}
