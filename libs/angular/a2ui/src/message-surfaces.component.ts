import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  signal,
  untracked,
} from '@angular/core';
import { KeyValuePipe } from '@angular/common';
import type { ChatA2uiRenderer } from '@threadplane/angular/chat';
import type { RenderEvent, ViewRegistry } from '@threadplane/angular/render';
import {
  createA2uiMessageParser,
  type A2uiActionMessage,
  type A2uiMessageParser,
} from '@threadplane/a2ui';
import { A2uiSurfaceComponent } from './surface.component';
import { createA2uiSurfaceStore, type A2uiSurfaceStore } from './surface-store';
import { a2uiBasicCatalog } from './catalog/index';

/** What `a2uiRenderer()` takes. */
export interface A2uiRendererOptions {
  /** The components surfaces render with. Defaults to `a2uiBasicCatalog()`. */
  readonly catalog?: ViewRegistry;
}

/**
 * Renders the A2UI content of one assistant message: it parses the message
 * source as it streams and shows one `<a2ui-surface>` per surface. `<chat>`
 * creates it through `a2uiRenderer()`.
 */
@Component({
  selector: 'a2ui-message-surfaces',
  standalone: true,
  imports: [KeyValuePipe, A2uiSurfaceComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let current = store();
    @for (entry of current.surfaces() | keyvalue; track entry.key) {
      <a2ui-surface
        [surface]="entry.value"
        [state]="current.surfaceStates().get(entry.key)"
        [catalog]="catalog()"
        [handlers]="handlers()"
        (action)="submitAction()($event)"
        (events)="onEvent($event, entry.key)"
      />
    }
  `,
})
export class A2uiMessageSurfacesComponent {
  readonly source = input.required<string>();
  readonly options = input<A2uiRendererOptions | undefined>(undefined);
  readonly handlers = input<
    Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>
  >({});
  readonly messageIndex = input(0);
  readonly submitAction = input<(message: A2uiActionMessage) => void>(
    () => undefined
  );
  readonly emitEvent = input<
    (event: RenderEvent, messageIndex: number, surfaceId: string) => void
  >(() => undefined);

  protected readonly catalog = computed(
    () => this.options()?.catalog ?? defaultCatalog()
  );
  protected readonly store = signal<A2uiSurfaceStore>(createA2uiSurfaceStore());
  private parser: A2uiMessageParser = createA2uiMessageParser();
  private parsed = '';

  constructor() {
    effect(() => {
      const source = this.source();
      untracked(() => this.push(source));
    });
  }

  protected onEvent(event: RenderEvent, surfaceId: string): void {
    this.emitEvent()(event, this.messageIndex(), surfaceId);
  }

  private push(source: string): void {
    // A same-id replacement need not extend what was parsed: start over.
    if (!source.startsWith(this.parsed)) {
      this.parser = createA2uiMessageParser();
      this.store.set(createA2uiSurfaceStore());
      this.parsed = '';
    }
    const delta = source.slice(this.parsed.length);
    this.parsed = source;
    if (!delta) return;
    try {
      const store = this.store();
      for (const message of this.parser.push(delta)) store.apply(message);
    } catch {
      // Malformed A2UI leaves the surfaces parsed so far.
    }
  }
}

let basicCatalog: ViewRegistry | undefined;
function defaultCatalog(): ViewRegistry {
  return (basicCatalog ??= a2uiBasicCatalog());
}

/**
 * The A2UI renderer for `<chat [a2ui]>`: with it, a message that carries A2UI
 * content renders its surfaces. Without it, the chat UI shows that content as
 * text and bundles none of the A2UI code.
 *
 * @example
 * ```ts
 * import { a2uiRenderer } from '@threadplane/angular/a2ui';
 *
 * protected readonly a2ui = a2uiRenderer();
 * // <chat [agent]="agent" [a2ui]="a2ui" />
 * ```
 */
export function a2uiRenderer(options?: A2uiRendererOptions): ChatA2uiRenderer {
  return { component: A2uiMessageSurfacesComponent, options };
}
