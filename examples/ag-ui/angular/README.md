# AG-UI Itinerary example (Angular)

A trip-planner demo where the agent edits a live itinerary UI over the
[AG-UI](https://github.com/cacheplane/threadplane) transport. It has a
chat/panel layout and an **App mode** that swaps the panel for a full-bleed
Google Map cockpit.

## Google Maps (App mode)

App mode renders a Google Map, which needs a Maps JavaScript API key. The key is
read from the repo-root `.env` at build time (via `scripts/inject-env.mjs`, which
writes a gitignored `src/environments/generated-keys.local.ts`). Add to the root
`.env`:

```
GOOGLE_MAPS_API_KEY=your_api_key_here
```

Without a key, App mode's map stays disabled (the rest of the demo still works).

### Dark map theme (optional)

App-mode markers use Google's **Advanced Markers**, which require the map to have
a **Map ID** — and a map with a Map ID takes its styling from a **cloud-based map
style** (the inline JSON dark theme no longer applies). To get the dark theme:

1. In the [Google Cloud Console](https://console.cloud.google.com/google/maps-apis/studio/maps),
   create a **vector Map ID** and a **dark map style**, and associate them.
2. Add the id to the root `.env`:

   ```
   GOOGLE_MAPS_MAP_ID=your_map_id_here
   ```

Without `GOOGLE_MAPS_MAP_ID`, the demo falls back to Google's `DEMO_MAP_ID` and
renders a **light** map — markers and routes still work, only the dark styling is
absent.
