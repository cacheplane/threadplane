'use client';
import { useEffect, useMemo, useState } from 'react';
import type { AgentSnapshot } from '@threadplane/core';
import {
  createMessageContent,
  type MessageContent,
  type MessageRow,
} from '@threadplane/content/messages';

const released = new WeakSet<MessageContent>();

/**
 * Rows for `snapshot`. An app-passed `content` is only projected through, never
 * disposed. Without one, the hook owns one projection per `session`: created
 * during render (pure), disposed in effect cleanup, and replaced when a
 * StrictMode remount finds it already disposed.
 */
export function useMessageContent(
  snapshot: AgentSnapshot,
  session: object,
  content?: MessageContent
): readonly MessageRow[] {
  const [revision, setRevision] = useState(0);
  // `revision` recreates the owner after a StrictMode remount. Owners created by
  // discarded renders are only garbage-collected; that is harmless because
  // Markdown owners hold no timers or listeners.
  const source = useMemo(
    () => content ?? createMessageContent(),
    [content, session, revision]
  );
  useEffect(() => {
    if (source === content) return;
    if (released.has(source)) {
      setRevision((value) => value + 1);
      return;
    }
    return () => {
      released.add(source);
      source.dispose();
    };
  }, [source, content]);
  // project() disposes removed messages' owners during render; safe because it
  // is idempotent per snapshot.
  return source.project(snapshot);
}
