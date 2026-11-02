import type { RenderEvent } from '@threadplane/render';

/** A rendered UI event associated with its transcript message and optional surface identifier. */
export interface ChatRenderEvent {
  readonly messageIndex: number;
  readonly surfaceId?: string;
  readonly event: RenderEvent;
}
