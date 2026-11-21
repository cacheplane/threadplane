import { Injectable, inject } from '@angular/core';
import { createAgentRef } from '@threadplane/angular';
import type { Session } from '@threadplane/ag-ui';
import { tools, action, view, ask, type ClientToolRegistry } from '@threadplane/angular/chat';
import { z } from 'zod/v4';
import { ItineraryStore } from './itinerary-store';
import { GeocodingService } from './geocoding.service';
import { DayCardComponent, DAY_CARD_SCHEMA } from './day-card.component';
import { ClearDayConfirmComponent } from './clear-day-confirm.component';

/**
 * Shape of the state the itinerary agent reads from `RunAgentInput.state`.
 * The Python graph's `State` TypedDict defines these three optional keys;
 * the Angular shell writes them into every `submit()` call so the backend
 * can pick up the user's palette choices.
 */
export type ItineraryState = {
  model?: string;
  /** `null` sends no effort, so the model's own default applies. */
  reasoning_effort?: string | null;
  gen_ui_mode?: string;
};

/** The itinerary agent's AG-UI session, with its state document typed. */
export type ItinerarySession = Session<ItineraryState>;

/**
 * Typed DI handle for the itinerary AG-UI agent.
 * Pass to `provideAgent(ITINERARY_AGENT, config)` in app.config and
 * `injectAgent(ITINERARY_AGENT)` at the inject site for a typed
 * `Agent<ItinerarySession>` without repeating the generic everywhere.
 */
export const ITINERARY_AGENT = createAgentRef<ItinerarySession>('ItineraryAgent');

/**
 * The palette knobs every run carries in its state. The shell owns the knob
 * signals and sets `read`; the session factory in app.config asks it each time
 * a request is sent, so a run always carries the knobs as they are then.
 */
@Injectable({ providedIn: 'root' })
export class ItineraryRunState {
  read: () => ItineraryState = () => ({});
}

/**
 * Returns `session` with the run state merged into the state patch of every
 * `submit` and `resume`, whoever calls them: the chat composition's composer,
 * a welcome suggestion, the itinerary panel or the interrupt panel. The knobs
 * win over a caller's own patch for the same key.
 */
export function withRunState(
  session: ItinerarySession,
  read: () => ItineraryState,
): ItinerarySession {
  return {
    ...session,
    submit: (input, options) => {
      const base = typeof input === 'string' ? { message: input } : input;
      return session.submit({ ...base, state: { ...base.state, ...read() } }, options);
    },
    resume: (responses, options) =>
      session.resume(responses, { ...options, state: { ...options?.state, ...read() } }),
  };
}

/** Schema for the `clear_day` ask tool — exported in case consumers want to
 *  derive types from it (e.g. `ViewProps<typeof CLEAR_DAY_SCHEMA>`). */
export const CLEAR_DAY_SCHEMA = z.object({ day: z.number().int().min(1) });

/** Client tools over the frontend-owned itinerary. Call inside an injection
 *  context (e.g. a field initializer in App). The descriptions are the ONLY
 *  steering the model gets — no system-prompt coaching (by design). */
export function itineraryClientTools(): ClientToolRegistry {
  const store = inject(ItineraryStore);
  const geocoding = inject(GeocodingService);
  return tools({
    get_itinerary: action(
      "Read the user's trip itinerary: every planned stop grouped by day (with ids).",
      z.object({}),
      async () => ({ days: store.days() }),
    ),
    add_stop: action(
      'Add a stop to a day of the trip itinerary. Afterwards, show the updated day with day_card.',
      z.object({ day: z.number().int().min(1), place: z.string(), note: z.string().optional() }),
      async ({ day, place, note }) => {
        const coords = (await geocoding.geocode(place)) ?? undefined;
        return { added: store.add(day, place, note, coords ? { coords } : undefined) };
      },
    ),
    move_stop: action(
      'Move an existing stop (matched by place name) to another day. Afterwards, show the updated day with day_card.',
      z.object({ place: z.string(), toDay: z.number().int().min(1) }),
      async ({ place, toDay }) => {
        const target = store.stops().find((s) => s.place.toLowerCase() === place.toLowerCase());
        if (!target) {
          return { error: `No stop named "${place}" — call get_itinerary to see what exists.` };
        }
        const toDayStops = store.stops().filter((s) => s.day === toDay && s.id !== target.id);
        store.reorder(target.id, toDay, toDayStops.length);
        return { moved: { ...target, day: toDay } };
      },
    ),
    reorder_stop: action(
      'Reorder a stop within or across days. Use after the user describes a sequence change (e.g., "put Louvre first", "move Eiffel to day 2 second"). `toIndex` is zero-based within the target day.',
      z.object({
        place: z.string(),
        toDay: z.number().int().min(1),
        toIndex: z.number().int().min(0),
      }),
      async ({ place, toDay, toIndex }) => {
        const target = store.stops().find((s) => s.place.toLowerCase() === place.toLowerCase());
        if (!target) {
          return { error: `No stop named "${place}" — call get_itinerary to see what exists.` };
        }
        store.reorder(target.id, toDay, toIndex);
        return { reordered: { ...target, day: toDay, toIndex } };
      },
    ),
    clear_day: ask(
      'Ask the user to confirm clearing every stop on a day, then clear it if they accept.',
      CLEAR_DAY_SCHEMA,
      ClearDayConfirmComponent,
    ),
    day_card: view(
      "Show the user a visual recap card for one itinerary day. Call it after add_stop or move_stop with the day's full updated place list.",
      DAY_CARD_SCHEMA,
      DayCardComponent,
    ),
  });
}
