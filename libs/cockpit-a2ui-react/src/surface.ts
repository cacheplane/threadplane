import type { A2uiActionMessage } from '@threadplane/a2ui';
import type { RenderSpecData } from '@threadplane/react/render';
import type { Data } from './data';
import { prepareSurface, type SurfaceKind } from './protocol';
import {
  createRenderState,
  type RenderState,
} from '@threadplane/content/render-state';
import { createActions, type Actions } from './actions';
import { createBookingForm, type BookingForm } from './form';
/** Presentation borrows immutable data and pre-captured, fenced commands only. */
export interface SurfaceView {
  readonly id: string;
  readonly kind: SurfaceKind;
  readonly messageId: string;
  readonly spec: RenderSpecData;
  readonly prose: string;
  readonly wire: string;
  readonly model: Readonly<Record<string, Data>>;
  readonly form?: Pick<BookingForm, 'getSnapshot' | 'subscribe'>;
  readonly edits: Readonly<Record<string, (draft: string) => void>>;
  readonly actions: Readonly<Record<string, () => boolean>>;
}

export interface FlightSurfaceOptions {
  readonly content: string;
  readonly expected: SurfaceKind;
  readonly messageId: string;
  readonly id: string;
  readonly isCurrent: () => boolean;
  readonly onAction: (payload: Readonly<A2uiActionMessage>) => void;
}
export interface FlightSurface {
  readonly view: SurfaceView;
  revoke(): void;
  dispose(): void;
}
/** Owns only presentation resources; transport admission stays with the caller. */
export function createFlightSurface(
  options: FlightSurfaceOptions
): FlightSurface {
  const {
    content,
    expected: kind,
    id,
    messageId,
    isCurrent,
    onAction,
  } = options;
  const surface = prepareSurface(content, kind);
  let state: RenderState | undefined,
    form: BookingForm | undefined,
    actions: Actions | undefined;
  let live = true,
    commandsClosed = false,
    disposed = false;
  function revoke() {
    live = false;
    if (commandsClosed) return;
    commandsClosed = true;
    try {
      actions?.dispose();
    } finally {
      form?.dispose();
    }
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      revoke();
    } finally {
      try {
        surface.dispose();
      } finally {
        state?.dispose();
      }
    }
  }
  const usable = () => live && isCurrent() && live;
  try {
    state = createRenderState(surface.model);
    if (kind === 'booking') form = createBookingForm(surface, state);
    actions = createActions(surface, {
      form,
      timestamp: () => {
        const timestamp = new Date().toISOString();
        // The clock may reenter application teardown or replace the active epoch.
        if (!usable()) revoke();
        return timestamp;
      },
      dispatch(payload) {
        if (usable()) onAction(payload);
      },
    });
    const edits: Record<string, (draft: string) => void> = Object.create(null);
    const activations: Record<string, () => boolean> = Object.create(null);
    for (const component of Object.values(surface.components)) {
      if (
        form &&
        ['ChoicePicker', 'DateTimeInput', 'TextField'].includes(
          component.component
        )
      ) {
        const edit = form.captureEdit(component.id);
        edits[component.id] = (draft) => {
          if (usable()) edit(draft);
        };
      }
      if (component.component === 'Button') {
        const activate = actions.capability(component.id);
        activations[component.id] = () => usable() && activate();
      }
    }
    const view: SurfaceView = Object.freeze({
      id,
      kind,
      messageId,
      spec: surface.spec,
      prose: surface.prose,
      wire: content,
      model: surface.model,
      ...(form
        ? {
            form: Object.freeze({
              getSnapshot: form.getSnapshot,
              subscribe: form.subscribe,
            }),
          }
        : {}),
      edits: Object.freeze(edits),
      actions: Object.freeze(activations),
    });
    return Object.freeze({ view, revoke, dispose });
  } catch (error) {
    // Preserve the preparation error after every acquired resource has been closed.
    try {
      dispose();
    } catch {
      /* Disposal cannot replace the admission failure. */
    }
    throw error;
  }
}
