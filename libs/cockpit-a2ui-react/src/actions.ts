import type { A2uiActionMessage } from '@threadplane/a2ui';
import { copyData, equalData, plainRecord, type Data } from './data.js';
import { validateAction, type PreparedSurface } from './protocol.js';
import type { BookingForm } from './form.js';

export interface ActionOptions {
  readonly form?: BookingForm;
  readonly timestamp: () => string;
  readonly dispatch: (payload: Readonly<A2uiActionMessage>) => void;
}
export interface Actions {
  capability(componentId: string): () => boolean;
  dispose(): void;
}
/** Captures event data only; the application owns admission and transport. */
export function createActions(
  surface: PreparedSurface,
  options: ActionOptions
): Actions {
  const { form, timestamp: clock, dispatch } = options;
  if (form && form.identity !== surface.identity)
    throw Error('Action form epoch mismatch');
  if (surface.surfaceId === 'booking' && !form)
    throw Error('Booking action needs its form facade');
  let live = true,
    activating = false;
  return Object.freeze({
    capability(id: string) {
      const token = surface.token(id),
        component = surface.components[id];
      const labelId = String(component?.child),
        labelToken = surface.token(labelId);
      return () => {
        if (
          !live ||
          activating ||
          !surface.current(id, token) ||
          !surface.current(labelId, labelToken) ||
          component?.component !== 'Button'
        )
          return false;
        if (form && !form.canSubmit()) return false;
        const snapshot = form?.getSnapshot();
        const model = (snapshot?.model ?? surface.model) as unknown as Readonly<
          Record<string, Data>
        >;
        validateAction(component.action, surface.surfaceId, model);
        if (
          !plainRecord(component.action) ||
          !plainRecord(component.action.event) ||
          !plainRecord(component.action.event.context)
        )
          return false;
        const event = component.action.event,
          context: Record<string, Data> = {};
        const authoredContext = event.context as Readonly<Record<string, Data>>;
        for (const [key, value] of Object.entries(authoredContext))
          context[key] = plainRecord(value)
            ? model[String(value.path).slice(1)]
            : value;
        // A literal booking value cannot override a later visible edit.
        if (
          event.name === 'bookingSubmit' &&
          !equalData(
            { ...context, formId: undefined },
            { ...model, formId: undefined }
          )
        )
          return false;
        const child = surface.components[String(component.child)];
        const authored = child?.component === 'Text' ? child.text : undefined;
        const label = plainRecord(authored)
          ? model[String(authored.path).slice(1)]
          : authored;
        activating = true;
        try {
          const timestamp = clock();
          if (
            typeof timestamp !== 'string' ||
            !timestamp ||
            !Number.isFinite(Date.parse(timestamp))
          )
            throw Error('Invalid action timestamp');
          const payload = copyData({
            version: 'v0.9',
            action: {
              name: event.name,
              surfaceId: surface.surfaceId,
              sourceComponentId: id,
              timestamp,
              context,
              ...(typeof label === 'string' ? { label } : {}),
            },
            ...(surface.sendDataModel
              ? {
                  metadata: {
                    a2uiClientDataModel: {
                      surfaces: { [surface.surfaceId]: model },
                    },
                  },
                }
              : {}),
          }) as unknown as Readonly<A2uiActionMessage>;
          // Clock/capture callbacks cannot resurrect retired or changed authority.
          if (
            !live ||
            !surface.current(id, token) ||
            !surface.current(labelId, labelToken) ||
            (form && (!form.canSubmit() || form.getSnapshot() !== snapshot))
          )
            return false;
          dispatch(payload);
          return true;
        } finally {
          activating = false;
        }
      };
    },
    dispose() {
      live = false;
    },
  });
}
