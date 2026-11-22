import type { Type } from '@angular/core';
import type { RenderEvent } from '@threadplane/angular/render';

/**
 * What `<chat [a2ui]>` takes: the component that renders the A2UI content of one
 * assistant message. Build one with `a2uiRenderer()` from
 * `@threadplane/angular/a2ui`.
 *
 * The chat UI only recognizes A2UI content (a message that starts with
 * `---a2ui_JSON---`) and hands its source to this component, so an application
 * that renders no A2UI bundles none of it. Without a renderer, A2UI content
 * shows as its source text.
 *
 * @example
 * ```ts
 * import { a2uiRenderer } from '@threadplane/angular/a2ui';
 *
 * protected readonly a2ui = a2uiRenderer();
 * // <chat [agent]="agent" [a2ui]="a2ui" />
 * ```
 */
export interface ChatA2uiRenderer {
  /** A standalone component that takes the {@link ChatA2uiInputs} inputs. */
  readonly component: Type<unknown>;
  /** Passed unchanged to the component's `options` input. */
  readonly options?: unknown;
}

/** The inputs `<chat>` sets on a {@link ChatA2uiRenderer} component. */
export interface ChatA2uiInputs {
  /** The message content after its `---a2ui_JSON---` marker. It grows while the message streams. */
  readonly source: string;
  /** The renderer's own `options`. */
  readonly options: unknown;
  /** The chat's `[handlers]`, for actions a surface runs locally. */
  readonly handlers: Record<
    string,
    (params: Record<string, unknown>) => unknown | Promise<unknown>
  >;
  /** The message's index in the transcript, passed back with each event. */
  readonly messageIndex: number;
  /** Sends an A2UI action message to the agent as a user turn. */
  readonly submitAction: (message: object) => void;
  /** Forwards a surface's render event to the chat's `(renderEvent)` output. */
  readonly emitEvent: (
    event: RenderEvent,
    messageIndex: number,
    surfaceId: string
  ) => void;
}
