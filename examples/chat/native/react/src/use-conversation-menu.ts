import { useEffect, useState } from 'react';
import type {
  OverflowMenuProps,
  ThreadListProps,
} from '@threadplane/react/chat';

export type ConversationMenuControl = Pick<
  OverflowMenuProps,
  'open' | 'onOpenChange' | 'anchorPoint' | 'returnFocusTo'
>;

/** One request object owns its close callback, even across A → B → A. */
export function useConversationMenu(
  rows: readonly {
    readonly id: string;
    readonly occurrenceKey?: string;
  }[]
) {
  const [request, setRequest] = useState<{
    readonly id: string;
    readonly occurrenceKey: string | undefined;
    readonly anchorPoint: { readonly x: number; readonly y: number } | null;
    readonly returnFocusTo: HTMLElement | null;
  } | null>(null);
  // A row moving between lists gets a new DOM/menu owner even when its ID
  // remains loaded. Reject that old occurrence during render, before a portal
  // can open or focus a replacement row; metadata changes retain ownership.
  const visible =
    request !== null &&
    rows.some(
      (row) =>
        row.id === request.id && row.occurrenceKey === request.occurrenceKey
    );
  useEffect(() => {
    if (request && !visible) setRequest(null);
  }, [request, visible]);

  const onContextMenu: NonNullable<ThreadListProps['onContextMenu']> = (
    id,
    event
  ) => {
    event.preventDefault();
    setRequest({
      id,
      occurrenceKey: rows.find((row) => row.id === id)?.occurrenceKey,
      anchorPoint:
        'clientX' in event ? { x: event.clientX, y: event.clientY } : null,
      returnFocusTo: event.currentTarget,
    });
  };
  const forThread = (id: string): ConversationMenuControl => {
    const current = visible && request?.id === id ? request : null;
    return {
      open: current !== null,
      anchorPoint: current?.anchorPoint ?? null,
      returnFocusTo: current?.returnFocusTo ?? null,
      onOpenChange(open) {
        if (open)
          setRequest({
            id,
            occurrenceKey: rows.find((row) => row.id === id)?.occurrenceKey,
            anchorPoint: null,
            returnFocusTo: null,
          });
        else setRequest((latest) => (latest === current ? null : latest));
      },
    };
  };
  return { onContextMenu, forThread };
}
