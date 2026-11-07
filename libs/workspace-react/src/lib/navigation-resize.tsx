'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'threadplane.docs-navigation.width.v1';
const DEFAULT_WIDTH = 328;
const MIN_WIDTH = 250;
const MAX_WIDTH = 440;
const STEP = 10;

function boundedWidth(value: unknown, fallback = DEFAULT_WIDTH): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
    : fallback;
}

export function useNavigationWidth(enabled: boolean, defaultWidth = DEFAULT_WIDTH) {
  const resetWidth = boundedWidth(defaultWidth);
  const [width, setWidth] = useState(resetWidth);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = enabled;
    if (enabled) {
      try {
        setWidth(
          boundedWidth(
            JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null'),
            resetWidth
          )
        );
      } catch {
        setWidth(resetWidth);
      }
    }
    return () => {
      mounted.current = false;
    };
  }, [enabled, resetWidth]);

  const update = useCallback((value: number, persist = true) => {
    if (!mounted.current) return;
    const next = boundedWidth(value, resetWidth);
    setWidth(next);
    if (persist) {
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Navigation remains adjustable when browser storage is unavailable.
      }
    }
  }, [resetWidth]);

  return { width, update };
}

interface NavigationResizeHandleProps {
  width: number;
  defaultWidth?: number;
  onChange: (width: number, persist: boolean) => void;
}

interface NavigationDrag {
  id: number;
  element: HTMLDivElement;
  left: number;
  width: number;
  changed: boolean;
}

function releaseCapture(drag: NavigationDrag) {
  try {
    drag.element.releasePointerCapture?.(drag.id);
  } catch {
    // Pointer cancellation can release capture before its event arrives.
  }
}

export function NavigationResizeHandle({
  width,
  defaultWidth = DEFAULT_WIDTH,
  onChange,
}: NavigationResizeHandleProps) {
  const resetWidth = boundedWidth(defaultWidth);
  const active = useRef<NavigationDrag | null>(null);
  useEffect(
    () => () => {
      const drag = active.current;
      active.current = null;
      if (drag) releaseCapture(drag);
    },
    []
  );

  const finish = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = active.current;
    if (!drag || drag.id !== event.pointerId) return;
    active.current = null;
    releaseCapture(drag);
    if (drag.changed) onChange(drag.width, true);
  };

  return (
    <div
      role="separator"
      aria-label="Resize navigation"
      aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH}
      aria-valuemax={MAX_WIDTH}
      aria-valuenow={width}
      tabIndex={0}
      className="workspace-navigation-resize"
      onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home'].includes(event.key)) return;
        event.preventDefault();
        onChange(
          boundedWidth(
            event.key === 'Home'
              ? resetWidth
              : width + (event.key === 'ArrowRight' ? STEP : -STEP)
          ),
          true
        );
      }}
      onDoubleClick={() => onChange(resetWidth, true)}
      onPointerDown={(event) => {
        if (event.button !== 0 || active.current) return;
        event.preventDefault();
        event.currentTarget.focus();
        active.current = {
          id: event.pointerId,
          element: event.currentTarget,
          left:
            event.currentTarget.parentElement?.getBoundingClientRect().left ??
            0,
          width,
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
        if (
          !drag ||
          drag.id !== event.pointerId ||
          !Number.isFinite(event.clientX)
        )
          return;
        drag.width = boundedWidth(event.clientX - drag.left);
        drag.changed = true;
        onChange(drag.width, false);
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      <span aria-hidden="true" />
    </div>
  );
}
