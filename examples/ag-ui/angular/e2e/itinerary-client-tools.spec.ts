import { test, expect } from '@playwright/test';
import { attachBrowserHygiene, messageInput, openDemo, sendButton } from './test-helpers';

// Exercises the frontend-declared / frontend-executed client tools over the
// AG-UI transport against THIS app. The catalog ships to the backend, the model
// emits a tool call, the browser executes it against the shared ItineraryStore,
// the ToolMessage re-runs the graph, and the continuation streams back. Each
// test starts from the store seed (Day 1: Louvre + Eiffel Tower, Day 2: Musée
// d'Orsay) by clearing the persisted key before the page hydrates.
//
// The itinerary panel only renders in App mode (it's the floating map overlay;
// plain embed/popup/sidebar no longer shows it), so these tests open the demo at
// `/sidebar?appmode=on`. App mode now runs in popup OR sidebar (not embed, which
// has no background for the map), is driven from the URL regardless of the
// key-gated toolbar toggle, and the overlay panel renders independent of the map
// — so the same panel DOM (region "Trip itinerary", section.itin__day,
// .itin__handle …) is present even without a GOOGLE_MAPS_API_KEY in CI.
const STORAGE_KEY = 'ag-ui-demo:itinerary';

test.beforeEach(async ({ page }) => {
  // Runs on every navigation, before app bootstrap — so ItineraryStore
  // hydrates from SEED rather than a stale localStorage payload. openDemo's
  // own localStorage.clear() runs after the first paint; this guarantees the
  // key is already absent the moment the store reads it.
  await page.addInitScript((key) => localStorage.removeItem(key), STORAGE_KEY);
});

test('panel renders the seeded itinerary', async ({ page }) => {
  await openDemo(page, '/sidebar?appmode=on');

  const panel = page.getByRole('region', { name: 'Trip itinerary' });
  await expect(panel).toBeVisible();
  await expect(panel).toContainText('Louvre');
  await expect(panel).toContainText('Eiffel Tower');
  await expect(panel).toContainText("Musée d'Orsay");
});

test('read round-trip: get_itinerary executes in the browser and the run continues', async ({
  page,
}) => {
  await openDemo(page, '/sidebar?appmode=on');
  const hygiene = attachBrowserHygiene(page);

  await messageInput(page).fill("What's on my itinerary?");
  await sendButton(page).click();

  // The first run returns only a tool call; the browser executes get_itinerary
  // against the store, the ToolMessage re-runs the graph, and the continuation
  // streams the recap. Wait on that final content rather than the first settle.
  await expect(page.getByText('You have 3 stops planned')).toBeVisible({ timeout: 30_000 });

  expect(hygiene.consoleErrors).toEqual([]);
});

test('ask chain: clear_day confirm mutates the panel and resumes the run', async ({ page }) => {
  await openDemo(page, '/sidebar?appmode=on');

  await messageInput(page).fill('Clear my day 2 plans');
  await sendButton(page).click();

  // The clear_day ask renders its confirm component; the run is paused on the
  // emitted tool result until the user decides.
  const confirm = page.locator('app-clear-day-confirm');
  await expect(confirm).toBeVisible({ timeout: 30_000 });
  await expect(confirm).toContainText('day 2');

  // Nothing has mutated yet — the panel still shows day 2's stop.
  const panel = page.getByRole('region', { name: 'Trip itinerary' });
  await expect(panel).toContainText("Musée d'Orsay");

  // Confirming writes the store (panel updates live) and emits the tool result
  // that resumes the run, whose continuation streams the closing line.
  await confirm.getByRole('button', { name: 'Clear' }).click();

  await expect(panel).not.toContainText("Musée d'Orsay");
  await expect(page.getByText('Done — day 2 is cleared.')).toBeVisible({ timeout: 30_000 });

  // The confirm card freezes once resolved: the chat library writes the emitted
  // result back onto the local tool call, so the component re-renders into its
  // frozen state — the interactive buttons are gone and a resolved line shows.
  await expect(confirm).toContainText('Day 2 cleared');
  await expect(confirm.getByRole('button', { name: 'Clear' })).toHaveCount(0);
  await expect(confirm.getByRole('button', { name: 'Cancel' })).toHaveCount(0);
});

test('move_stop action: panel mutates — Eiffel Tower moves from day 1 to day 2', async ({
  page,
}) => {
  await openDemo(page, '/sidebar?appmode=on');

  // Seed has Eiffel Tower under Day 1 — verify it's there before sending.
  const panel = page.getByRole('region', { name: 'Trip itinerary' });
  await expect(panel).toBeVisible();

  // Day sections are <section class="itin__day"> each containing an <h3> with
  // "Day N" text and a <ul class="itin__stops"> with the stop rows.
  const day1Section = panel.locator('section.itin__day').filter({ hasText: 'Day 1' });
  const day2Section = panel.locator('section.itin__day').filter({ hasText: 'Day 2' });

  await expect(day1Section).toContainText('Eiffel Tower');
  await expect(day2Section).not.toContainText('Eiffel Tower');

  await messageInput(page).fill('Move the Eiffel Tower to day 2');
  await sendButton(page).click();

  // move_stop is an action tool: the browser executes it immediately (no
  // user interaction required). The store update is synchronous, so the panel
  // re-renders before the continuation streams back. Wait on the continuation
  // text to confirm both the tool execution AND the second run have finished.
  await expect(page.getByText('Done — the Eiffel Tower is now on day 2.')).toBeVisible({
    timeout: 30_000,
  });

  // Panel must reflect the mutation: Eiffel Tower is now under Day 2, gone from Day 1.
  await expect(day2Section).toContainText('Eiffel Tower');
  await expect(day1Section).not.toContainText('Eiffel Tower');
});

test('day_card view: component renders with model-filled props and run auto-continues', async ({
  page,
}) => {
  await openDemo(page, '/sidebar?appmode=on');

  await messageInput(page).fill('Show me a recap card for day 1');
  await sendButton(page).click();

  // day_card is a `view` tool: it auto-acks without user interaction, so the
  // run continues immediately (two runs total, same pattern as the read test).
  // The card must be visible and contain the model-supplied day number and places.
  const card = page.locator('app-day-card');
  await expect(card).toBeVisible({ timeout: 30_000 });
  await expect(card).toContainText('Day 1');
  await expect(card).toContainText('Louvre');

  // Continuation text confirms the second run finished.
  await expect(page.getByText("Here's your day 1 recap.")).toBeVisible({ timeout: 30_000 });
});

test('user can drag-reorder stops within a day', async ({ page }) => {
  await openDemo(page, '/sidebar?appmode=on');

  const panel = page.getByRole('region', { name: 'Trip itinerary' });

  // Seed order on day 1 is Louvre (index 0), then Eiffel Tower (index 1).
  // Drag Eiffel above Louvre using the cdkDragHandle on each row. The handle is
  // hidden until hover (opacity:0), so we drive the pointer directly via mouse
  // coordinates rather than locator.hover() to keep the row hover state stable
  // for the duration of the drag.
  const eiffelRow = panel.locator('[id="itin-day-1"] li.itin__stop').filter({
    hasText: 'Eiffel Tower',
  });
  const louvreRow = panel.locator('[id="itin-day-1"] li.itin__stop').filter({ hasText: 'Louvre' });

  // Make the handle reachable by hovering the row first so opacity flips to 1.
  await eiffelRow.hover();
  const handle = eiffelRow.locator('.itin__handle');
  const handleBox = await handle.boundingBox();
  const targetBox = await louvreRow.boundingBox();
  if (!handleBox || !targetBox) throw new Error('drag boxes missing');

  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + 2; // top edge of louvre row → drop above it

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // CDK needs the pointer to actually move while down to start the drag gesture.
  // Multiple steps make the drag-start heuristic reliable.
  await page.mouse.move(startX, startY - 10, { steps: 5 });
  await page.mouse.move(endX, endY, { steps: 10 });
  await page.mouse.up();

  // First text-content match in the day-1 list should now be Eiffel.
  const day1Stops = panel.locator('[id="itin-day-1"] .itin__place-name');
  await expect(day1Stops.first()).toHaveText('Eiffel Tower');
});

test('reorder_stop: agent puts Louvre last on day 1', async ({ page }) => {
  await openDemo(page, '/sidebar?appmode=on');
  const hygiene = attachBrowserHygiene(page);

  await messageInput(page).fill('Put Louvre last on day 1.');
  await sendButton(page).click();

  const day1Stops = page
    .getByRole('region', { name: 'Trip itinerary' })
    .locator('[id="itin-day-1"] .itin__place-name');
  await expect(day1Stops.last()).toHaveText('Louvre', { timeout: 30_000 });

  expect(hygiene.consoleErrors).toEqual([]);
});
