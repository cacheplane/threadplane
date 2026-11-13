'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';

/** What an application action returns; a rejection rolls the row back. */
export type RowActionResult = Promise<unknown> | void;

const NO_IDS: ReadonlySet<string> = new Set();
const NO_NAMES: ReadonlyMap<string, string> = new Map();

async function settle(run: () => RowActionResult): Promise<void> {
  try {
    await run();
  } catch {
    /* The override is cleared below, which restores the supplied row. */
  }
}

/**
 * Row overrides shown while an application action is in flight. Each override
 * is dropped when its action settles, so the supplied rows decide the result.
 */
export function useOptimisticRows() {
  const [hidden, setHidden] = useState(NO_IDS);
  const [names, setNames] = useState(NO_NAMES);
  const hide = async (id: string, run: () => RowActionResult) => {
    setHidden((current) => new Set(current).add(id));
    await settle(run);
    setHidden((current) => {
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  };
  const rename = async (
    id: string,
    name: string,
    run: () => RowActionResult
  ) => {
    setNames((current) => new Map(current).set(id, name));
    await settle(run);
    setNames((current) => {
      const next = new Map(current);
      next.delete(id);
      return next;
    });
  };
  return { hidden, names, hide, rename, settle };
}

/** Which control of a row takes focus once the row's editor or dialog is gone. */
export interface RowFocusRequest {
  readonly id: string;
  readonly part: 'select' | 'menu';
}

/**
 * Moves focus to a row control after the focused control left the document,
 * and only then: focus the person has since placed elsewhere is kept.
 */
export function useRowFocus(
  list: RefObject<HTMLElement | null>,
  selectClass: string
) {
  const [request, setRequest] = useState<RowFocusRequest | null>(null);
  const handled = useRef<RowFocusRequest | null>(null);
  useEffect(() => {
    if (!request || handled.current === request) return;
    handled.current = request;
    const root = list.current;
    const doc = root?.ownerDocument;
    if (!root || !doc) return;
    const attempt = () => {
      const active = doc.activeElement;
      if (active && active !== doc.body && active.isConnected) return false;
      const row = Array.from(root.children).find(
        (child) => (child as HTMLElement).dataset['rowId'] === request.id
      );
      const select = row?.querySelector<HTMLElement>(`.${selectClass}`);
      const menu = row?.querySelector<HTMLElement>(
        '.tp-overflow-menu__trigger'
      );
      ((request.part === 'menu' ? menu : null) ?? select)?.focus();
      return true;
    };
    if (attempt()) return;
    // A closing dialog still holds focus during this commit and gives it up
    // in its own follow-up render; look once more after that.
    const timer = setTimeout(attempt, 0);
    return () => clearTimeout(timer);
  }, [request, list, selectClass]);
  return setRequest;
}

/** The row that should take focus when the row with this ID leaves the list. */
export function neighborId(
  rows: readonly { readonly id: string }[],
  id: string
): string | undefined {
  const index = rows.findIndex((row) => row.id === id);
  return index < 0 ? undefined : (rows[index + 1] ?? rows[index - 1])?.id;
}
