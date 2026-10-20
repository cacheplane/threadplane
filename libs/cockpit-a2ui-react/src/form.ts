import type { RenderState } from '@threadplane/content/render-state';
import { equalData, plainRecord } from './data.js';
import {
  AIRPORTS,
  FARES,
  assertBookingModel,
  type BookingField,
  type PreparedSurface,
} from './protocol.js';

export interface BookingData {
  readonly origin: readonly string[];
  readonly dest: readonly string[];
  readonly fare_class: readonly string[];
  readonly date: string;
  readonly passengers: number;
}
export interface BookingSnapshot {
  readonly model: BookingData;
  readonly drafts: Readonly<Record<BookingField, string>>;
  readonly errors: Readonly<Partial<Record<BookingField, string>>>;
  readonly valid: boolean;
}
export interface BookingForm {
  readonly identity: object;
  getSnapshot(): BookingSnapshot;
  subscribe(notify: () => void): () => void;
  edit(componentId: string, draft: string): void;
  captureEdit(componentId: string): (draft: string) => void;
  canSubmit(): boolean;
  dispose(): void;
}
/** Calendar validation uses only lexical integers, never local time or today's date. */
function calendar(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const days = [
    31,
    year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  return (
    year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1]
  );
}
function passenger(value: string) {
  return (
    /^\d+$/.test(value) &&
    Number.isSafeInteger(Number(value)) &&
    Number(value) > 0
  );
}
function errorsFor(
  model: BookingData,
  drafts: Readonly<Record<BookingField, string>>
) {
  const errors: Partial<Record<BookingField, string>> = {};
  if (!AIRPORTS.includes(drafts.origin))
    errors.origin = 'Choose an origin airport.';
  if (!AIRPORTS.includes(drafts.dest))
    errors.dest = 'Choose a destination airport.';
  else if (drafts.origin === drafts.dest)
    errors.dest = 'Choose different origin and destination airports.';
  if (!FARES.includes(drafts.fare_class))
    errors.fare_class = 'Choose a fare class.';
  if (!calendar(drafts.date)) errors.date = 'Enter a real date as YYYY-MM-DD.';
  if (!passenger(drafts.passengers))
    errors.passengers = 'Enter a positive safe whole number.';
  // Each valid draft must describe exactly the same typed authority.
  if (!errors.passengers && Number(drafts.passengers) !== model.passengers)
    errors.passengers = 'Passenger value changed outside this form.';
  for (const field of ['origin', 'dest', 'fare_class'] as const)
    if (
      !errors[field] &&
      (model[field].length !== 1 || model[field][0] !== drafts[field])
    )
      errors[field] = 'Selection changed outside this form.';
  if (!errors.date && drafts.date !== model.date)
    errors.date = 'Date changed outside this form.';
  return Object.freeze(errors);
}
/** Borrow one application-owned render state. This facade alone publishes validity. */
export function createBookingForm(
  surface: PreparedSurface,
  state: RenderState
): BookingForm {
  if (
    surface.surfaceId !== 'booking' ||
    !equalData(surface.model, state.getSnapshot())
  )
    throw Error('Booking owner mismatch');
  assertBookingModel(state.getSnapshot());
  const initial = state.getSnapshot() as unknown as BookingData;
  const controls = new Map<string, { field: BookingField; token: object }>();
  for (const c of Object.values(surface.components)) {
    if (
      !['ChoicePicker', 'DateTimeInput', 'TextField'].includes(c.component) ||
      !plainRecord(c.value)
    )
      continue;
    const field = String(c.value.path).slice(1) as BookingField;
    controls.set(c.id, { field, token: surface.token(c.id)! });
  }
  const root = surface.token('root');
  let live = true,
    busy = false,
    writing = false,
    drift = false;
  const queue: Array<{ id: string; token: object | undefined; draft: string }> =
    [];
  const registrations = new Set<{ notify: () => void }>();
  function snapshot(
    model: BookingData,
    drafts: Readonly<Record<BookingField, string>>
  ): BookingSnapshot {
    const errors = drift
      ? Object.freeze({
          ...errorsFor(model, drafts),
          passengers:
            'Form data changed outside this form. Start a new conversation.',
        })
      : errorsFor(model, drafts);
    return Object.freeze({
      model,
      drafts: Object.freeze(drafts),
      errors,
      valid: !drift && Object.keys(errors).length === 0,
    });
  }
  let current = snapshot(initial, {
    origin: initial.origin[0] ?? '',
    dest: initial.dest[0] ?? '',
    fare_class: initial.fare_class[0] ?? '',
    date: initial.date,
    passengers: String(initial.passengers),
  });
  function eligible() {
    return (
      live &&
      !drift &&
      surface.current('root', root) &&
      [...controls].every(([id, c]) => surface.current(id, c.token))
    );
  }
  function publish() {
    for (const r of [...registrations]) {
      if (!live) break;
      if (registrations.has(r))
        try {
          r.notify();
        } catch {
          /* An observer cannot reject a command. */
        }
    }
  }
  const unsubscribe = state.subscribe(() => {
    if (!live || writing) return;
    // An independent writer violates the borrowed form contract. Retire authority.
    drift = true;
    current = snapshot(current.model, current.drafts);
    const wasBusy = busy;
    busy = true;
    try {
      publish();
    } finally {
      busy = wasBusy;
    }
  });
  function run(id: string, token: object | undefined, draft: string) {
    if (!eligible() || typeof draft !== 'string') return;
    queue.push({ id, token, draft });
    if (busy) return;
    busy = true;
    try {
      while (queue.length && eligible()) {
        const command = queue.shift()!,
          control = controls.get(command.id);
        if (
          !control ||
          control.token !== command.token ||
          !surface.current(command.id, command.token)
        )
          continue;
        const { field } = control,
          c = surface.components[command.id],
          value = command.draft;
        if (current.drafts[field] === value) continue;
        let accepted = false,
          typed: unknown;
        if (field === 'passengers') {
          accepted = passenger(value);
          typed = Number(value);
        } else if (field === 'date') {
          accepted = calendar(value);
          typed = value;
        } else {
          const allowed = field === 'fare_class' ? FARES : AIRPORTS;
          const options = Array.isArray(c.options) ? c.options : [];
          accepted =
            value === '' ||
            (allowed.includes(value) &&
              options.some((o) => plainRecord(o) && o.value === value));
          typed = value === '' ? [] : [value];
        }
        const drafts = Object.freeze({ ...current.drafts, [field]: value });
        if (accepted) {
          writing = true;
          try {
            state.set('/' + field, typed);
          } finally {
            writing = false;
          }
          if (
            !equalData(state.getSnapshot(), {
              ...current.model,
              [field]: typed,
            })
          ) {
            drift = true;
            current = snapshot(current.model, drafts);
            publish();
            break;
          }
        }
        if (!eligible()) break;
        current = snapshot(
          state.getSnapshot() as unknown as BookingData,
          drafts
        );
        publish();
      }
    } finally {
      queue.length = 0;
      busy = false;
    }
  }
  return Object.freeze({
    identity: surface.identity,
    getSnapshot: () => current,
    subscribe(notify: () => void) {
      if (!live) return () => undefined;
      const registration = { notify };
      registrations.add(registration);
      return () => {
        registrations.delete(registration);
      };
    },
    edit: (id: string, draft: string) =>
      run(id, controls.get(id)?.token, draft),
    captureEdit(id: string) {
      const token = controls.get(id)?.token;
      return (draft: string) => run(id, token, draft);
    },
    canSubmit: () =>
      !busy &&
      eligible() &&
      Object.is(state.getSnapshot(), current.model) &&
      current.valid,
    dispose() {
      if (live) {
        live = false;
        queue.length = 0;
        registrations.clear();
        unsubscribe();
      }
    },
  });
}
