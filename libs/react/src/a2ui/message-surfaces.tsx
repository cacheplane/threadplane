'use client';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import { createA2uiMessageReader } from './message-reader.js';
import { A2uiSurface, type A2uiSurfaceProps } from './surface.js';

/**
 * The A2UI content of one assistant message. `MessageA2uiContent` from
 * `@threadplane/react/chat`, which `renderA2ui` receives, fits as it is.
 */
export interface A2uiMessageContent {
  /** Identifies the message. A different ID starts over with empty surfaces. */
  readonly messageId?: string;
  /**
   * Newline-delimited A2UI envelopes: the message content after its
   * `---a2ui_JSON---` marker. It may grow while the message streams.
   */
  readonly source: string;
  /** True while the message is still streaming, when the last line may be incomplete. */
  readonly streaming: boolean;
  /** Shown while the message streams and no surface is live yet. */
  readonly skeleton?: ReactNode;
}

/** One message's A2UI content, and what its surfaces do with actions. */
export interface A2uiMessageSurfacesProps
  extends Pick<
    A2uiSurfaceProps,
    'onAction' | 'onValidationError' | 'functions' | 'catalog' | 'className'
  > {
  readonly content: A2uiMessageContent;
}

function Surfaces({ content, ...surface }: A2uiMessageSurfacesProps) {
  const [reader] = useState(createA2uiMessageReader);
  // Reading here, not in an effect, puts a finished surface in the first render, on the server too.
  reader.read(content.source, content.streaming);
  const snapshot = useSyncExternalStore(
    reader.subscribe,
    reader.getSnapshot,
    reader.getSnapshot
  );
  if (snapshot.surfaces.length === 0)
    return content.streaming ? <>{content.skeleton}</> : null;
  const surfaces = reader.surfaces();
  return (
    <>
      {snapshot.surfaces.map((item) => (
        <A2uiSurface
          key={item.surfaceId}
          {...surface}
          surface={item}
          surfaces={surfaces}
        />
      ))}
    </>
  );
}

/**
 * Renders the surfaces one assistant message carries, from its A2UI envelope
 * source. It keeps one surfaces store for the message, reads each finished
 * line into it as the source grows, and renders every live surface with
 * `A2uiSurface`, in the order the surfaces went live. Edits made in a surface
 * stay in that store and survive later lines. While the message streams, the
 * last line is left until its newline arrives and `content.skeleton` stands in
 * until a surface is live; a finished message with no surface renders nothing.
 * A line that is not an A2UI envelope is skipped. A source that does not
 * extend what was already read, or another `messageId`, starts over and drops
 * the edits. `onAction`, `onValidationError`, `functions`, `catalog` and
 * `className` go to every surface.
 */
export function A2uiMessageSurfaces(props: A2uiMessageSurfacesProps) {
  return <Surfaces key={props.content.messageId} {...props} />;
}
