import type { ReactElement } from 'react';
import { cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientToolsController } from './tools';

const readings = {
  location: 'Portland', temperatureF: 68, conditions: 'Sunny',
  humidity: 55, windMph: 8,
};
const context = () => ({ signal: new AbortController().signal });
afterEach(() => { vi.useRealTimers(); cleanup(); });
type Controller = ReturnType<typeof createClientToolsController>;
/** The transcript call a session would report for a waiting booking. */
const call = (id: string, summary: string) =>
  ({ id, name: 'confirm_booking', args: { summary }, status: 'running' });
/** Draws the booking card `Chat` would show for that call. */
function card(controller: Controller, id: string, summary: string) {
  const view = controller.clientTools.render(call(id, summary));
  // Scoped to this card: several may be on the page.
  return within(render(view as ReactElement).container);
}

describe('authored client tools', () => {
  it('declares the complete five-tool catalog used by the shared graph', () => {
    const controller = createClientToolsController();
    expect(Object.keys(controller.tools)).toEqual([
      'get_weather', 'slow_status_check', 'weather_card',
      'weather_snapshot', 'confirm_booking',
    ]);
    expect(controller.tools.weather_snapshot.followUp).toBe(false);
    expect(controller.tools.weather_card.followUp).not.toBe(false);
    expect(controller.tools.weather_card.parameters).toMatchObject({
      type: 'object',
      required: ['location', 'temperatureF', 'conditions', 'humidity', 'windMph'],
      properties: { humidity: { minimum: 0, maximum: 100 }, windMph: { minimum: 0 } },
    });
  });

  it('returns only the explicit simulated weather readings', async () => {
    const controller = createClientToolsController();
    expect(await controller.tools.get_weather.handler({ location: 'Portland' }, context())).toEqual(readings);
    expect(controller.getSnapshot().weather).toEqual([]);
  });

  it('publishes owned finalized literal weather panels and retains them after acknowledgement', async () => {
    const controller = createClientToolsController();
    const input = { ...readings, location: '<script>_city_</script>', conditions: '**literal**' };
    expect(await controller.tools.weather_card.handler(input, context())).toEqual({ shown: true });
    input.location = 'Changed';
    const snapshot = controller.getSnapshot();
    expect(snapshot.weather[0]).toMatchObject({ location: '<script>_city_</script>', conditions: '**literal**' });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.weather)).toBe(true);
    expect(Object.isFrozen(snapshot.weather[0])).toBe(true);
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(await controller.tools.weather_snapshot.handler(readings, context())).toEqual({ shown: true });
    expect(controller.getSnapshot().weather).toHaveLength(2);
    expect(controller.getSnapshot().weather[0]).toBe(snapshot.weather[0]);
  });

  it.each([
    null, [], Object.create({ location: 'Inherited' }),
    { ...readings, location: '' }, { ...readings, conditions: 42 },
    { ...readings, temperatureF: NaN }, { ...readings, temperatureF: Infinity },
    { ...readings, humidity: -1 }, { ...readings, humidity: 101 },
    { ...readings, windMph: -1 }, { ...readings, extra: 'not declared' },
  ])('rejects malformed finalized readings before publishing: %j', async (input) => {
    const controller = createClientToolsController();
    await expect(controller.tools.weather_card.handler(input as never, context())).rejects.toThrow(/Invalid/);
    expect(controller.getSnapshot().weather).toEqual([]);
  });

  it('does not read argument accessors', async () => {
    const getter = vi.fn(() => 'city');
    const input = Object.defineProperty({ ...readings }, 'location', { get: getter, enumerable: true });
    const controller = createClientToolsController();
    await expect(controller.tools.weather_card.handler(input, context())).rejects.toThrow(/Invalid/);
    expect(getter).not.toHaveBeenCalled();
  });

  it.each(['get_weather', 'weather_card', 'weather_snapshot', 'confirm_booking', 'slow_status_check'] as const)(
    'cancellation during argument capture prevents effects and results for %s', async (name) => {
      const controller = createClientToolsController();
      const abort = new AbortController();
      const input = name === 'get_weather' ? { location: 'city' } : name === 'confirm_booking' ? { summary: 'booking' } : name === 'slow_status_check' ? {} : readings;
      const proxy = new Proxy(input, { getPrototypeOf(target) { abort.abort(); return Reflect.getPrototypeOf(target); } });
      await expect(controller.tools[name].handler(proxy as never, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
      expect(controller.getSnapshot()).toMatchObject({ weather: [] });
      expect(controller.clientTools.getSnapshot()).toEqual([]);
    }
  );

  it('disposal during argument capture cannot publish a finalized panel', async () => {
    const controller = createClientToolsController();
    const input = new Proxy(readings, { getPrototypeOf(target) { controller.dispose(); return Reflect.getPrototypeOf(target); } });
    await expect(controller.tools.weather_card.handler(input, context())).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.getSnapshot().weather).toEqual([]);
  });

  it('accepts own fields on a null-prototype record', async () => {
    const controller = createClientToolsController();
    expect(await controller.tools.weather_card.handler(Object.assign(Object.create(null), readings), context())).toEqual({ shown: true });
  });

  it('declares the booking as an ask tool whose card answers the call', async () => {
    const controller = createClientToolsController();
    expect(controller.tools.confirm_booking).toMatchObject({
      description: expect.stringContaining('fictional booking'),
      parameters: { type: 'object', required: ['summary'], additionalProperties: false },
    });
    const result = controller.tools.confirm_booking.handler({ summary: '<b>Fictional</b> booking' }, context());
    expect(controller.clientTools.getSnapshot()).toEqual([
      { name: 'confirm_booking', args: { summary: '<b>Fictional</b> booking' } },
    ]);
    const view = card(controller, 'c1', '<b>Fictional</b> booking');
    expect(view.getByText('<b>Fictional</b> booking')).toBeTruthy();
    expect(document.querySelector('b')).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Confirm booking' }));
    expect(await result).toEqual({ confirmed: true });
    expect(controller.clientTools.getSnapshot()).toEqual([]);
    expect(controller.clientTools.render(call('c1', '<b>Fictional</b> booking'))).toBeUndefined();
  });

  it('keeps identical concurrent booking requests independent and focuses only the oldest', async () => {
    const controller = createClientToolsController();
    const first = controller.tools.confirm_booking.handler({ summary: 'Same fictional booking' }, context());
    const second = controller.tools.confirm_booking.handler({ summary: 'Same fictional booking' }, context());
    const one = card(controller, 'c1', 'Same fictional booking');
    const two = card(controller, 'c2', 'Same fictional booking');
    expect(document.activeElement).toBe(one.getByRole('button', { name: 'Confirm booking' }));
    fireEvent.click(one.getByRole('button', { name: "Don't book" }));
    fireEvent.click(one.getByRole('button', { name: 'Confirm booking' }));
    fireEvent.click(two.getByRole('button', { name: 'Confirm booking' }));
    expect(await first).toEqual({ confirmed: false });
    expect(await second).toEqual({ confirmed: true });
    expect(controller.clientTools.getSnapshot()).toEqual([]);
  });

  it('abort revokes a waiting booking, and its card can no longer answer', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const view = card(controller, 'c1', 'Fictional booking');
    abort.abort();
    await rejected;
    fireEvent.click(view.getByRole('button', { name: 'Confirm booking' }));
    expect(controller.clientTools.getSnapshot()).toEqual([]);
    expect(controller.clientTools.render(call('c1', 'Fictional booking'))).toBeUndefined();
  });

  it('handles abort while the waiting booking is published', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    controller.clientTools.subscribe(() => abort.abort());
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.clientTools.getSnapshot()).toEqual([]);
  });

  it('disposal immediately revokes a waiting booking and cannot publish afterward', async () => {
    const controller = createClientToolsController();
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, context());
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.dispose();
    controller.dispose();
    await rejected;
    expect(controller.clientTools.getSnapshot()).toEqual([]);
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, context())).rejects.toMatchObject({ name: 'AbortError' });
    await expect(controller.tools.get_weather.handler({ location: 'city' }, context())).rejects.toMatchObject({ name: 'AbortError' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted handler before any booking waits', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    abort.abort();
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.clientTools.getSnapshot()).toEqual([]);
  });

  it('cancels a waiting booking if its publication disposes the controller', async () => {
    const controller = createClientToolsController();
    controller.clientTools.subscribe(() => controller.dispose());
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, context())).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('completes the local status check after three seconds and removes timer/listener', async () => {
    vi.useFakeTimers();
    const controller = createClientToolsController();
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.slow_status_check.handler({}, { signal: abort.signal });
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ label: 'status check', status: 'complete' });
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it.each(['abort', 'dispose'] as const)('cleans up a slow handler on %s', async (action) => {
    vi.useFakeTimers();
    const controller = createClientToolsController();
    const abort = new AbortController();
    const result = controller.tools.slow_status_check.handler({ label: 'demo' }, { signal: abort.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    if (action === 'abort') abort.abort();
    else controller.dispose();
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects already-aborted delay without scheduling a timer', async () => {
    vi.useFakeTimers();
    const controller = createClientToolsController();
    const abort = new AbortController();
    abort.abort();
    await expect(controller.tools.slow_status_check.handler({ label: 'demo' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ['get_weather', { location: 42 }],
    ['slow_status_check', { label: null }],
    ['confirm_booking', { summary: '  ' }],
  ] as const)('validates %s arguments before side effects', async (name, input) => {
    const controller = createClientToolsController();
    await expect(controller.tools[name].handler(input as never, context())).rejects.toThrow(/Invalid/);
    expect(controller.clientTools.getSnapshot()).toEqual([]);
  });
});
