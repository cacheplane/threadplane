import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientToolsController } from './tools';

const readings = {
  location: 'Portland', temperatureF: 68, conditions: 'Sunny',
  humidity: 55, windMph: 8,
};
const context = () => ({ signal: new AbortController().signal });
afterEach(() => vi.useRealTimers());

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
      expect(controller.getSnapshot()).toMatchObject({ weather: [], bookings: [] });
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

  it('keeps identical concurrent booking requests independent without runtime call IDs', async () => {
    const controller = createClientToolsController();
    const first = controller.tools.confirm_booking.handler({ summary: 'Same fictional booking' }, context());
    const second = controller.tools.confirm_booking.handler({ summary: 'Same fictional booking' }, context());
    const [one, two] = controller.getSnapshot().bookings;
    expect(one.id).not.toBe(two.id);
    expect(one.summary).toBe(two.summary);
    expect(controller.decide({ ...one }, true)).toBe(false);
    expect(controller.decide(one, false)).toBe(true);
    expect(controller.decide(one, true)).toBe(false);
    expect(controller.decide(two, true)).toBe(true);
    expect(await first).toEqual({ confirmed: false });
    expect(await second).toEqual({ confirmed: true });
    expect(controller.getSnapshot().bookings.map((entry) => entry.status)).toEqual(['cancelled', 'confirmed']);
  });

  it('consumes decision authority before reentrant publication', async () => {
    const controller = createClientToolsController();
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, context());
    const token = controller.getSnapshot().bookings[0];
    const duplicate = vi.fn(() => controller.decide(token, false));
    const release = controller.subscribe(duplicate);
    expect(controller.decide(token, true)).toBe(true);
    expect(duplicate).toHaveReturnedWith(false);
    expect(await result).toEqual({ confirmed: true });
    release();
    expect(Object.isFrozen(controller.getSnapshot().bookings[0])).toBe(true);
  });

  it('abort revokes a pending decision and removes its listener', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal });
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const token = controller.getSnapshot().bookings[0];
    abort.abort();
    await rejected;
    expect(controller.decide(token, true)).toBe(false);
    expect(controller.getSnapshot().bookings[0].status).toBe('aborted');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('handles abort during pending request publication', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    controller.subscribe(() => abort.abort());
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    const token = controller.getSnapshot().bookings[0];
    expect(token.status).toBe('aborted');
    expect(controller.decide(token, true)).toBe(false);
  });

  it('decision settlement cleans up handlers while retaining the completed panel', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal });
    controller.decide(controller.getSnapshot().bookings[0], true);
    await result;
    const snapshot = controller.getSnapshot();
    abort.abort();
    expect(controller.getSnapshot()).toBe(snapshot);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });

  it('disposal immediately revokes pending handlers and cannot publish afterward', async () => {
    const controller = createClientToolsController();
    const result = controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, context());
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const token = controller.getSnapshot().bookings[0];
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.dispose();
    controller.dispose();
    await rejected;
    expect(controller.decide(token, true)).toBe(false);
    await expect(controller.tools.get_weather.handler({ location: 'city' }, context())).rejects.toMatchObject({ name: 'AbortError' });
    expect(notify).not.toHaveBeenCalled();
  });

  it('rejects an already-aborted handler before admission or publication', async () => {
    const controller = createClientToolsController();
    const abort = new AbortController();
    abort.abort();
    await expect(controller.tools.confirm_booking.handler({ summary: 'Fictional booking' }, { signal: abort.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.getSnapshot().bookings).toEqual([]);
  });

  it('cancels an admitted handler if publication disposes its controller', async () => {
    const controller = createClientToolsController();
    controller.subscribe(() => controller.dispose());
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
    expect(controller.getSnapshot().bookings).toEqual([]);
  });
});
