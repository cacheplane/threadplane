import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientToolsController, type BookingArguments, type BookingAsk, type BookingDecision, type BookingInvocation } from './tools';

const weather = { location: 'Denver', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 };
const invocation: BookingInvocation = {
  ownerGeneration: 1, callId: 'call-real', assistantMessageId: 'assistant-real',
  sourceRunId: 'run-real', summary: 'Fictional Denver visit',
};
/** Stands in for the ask tool: records each question and waits like the real one. */
function fakeAsk() {
  const asks: { args: BookingArguments; signal: AbortSignal; resolve(decision: BookingDecision): void }[] = [];
  const ask: BookingAsk = {
    description: 'Ask',
    handler: (args, { signal }) => new Promise((resolve, reject) => {
      asks.push({ args, signal, resolve });
      signal.addEventListener('abort', () => reject(new DOMException('Client tool cancelled.', 'AbortError')), { once: true });
    }),
  };
  return { ask, asks };
}
function setup() {
  let current: BookingInvocation | undefined = invocation;
  const read = vi.fn(() => current);
  const { ask, asks } = fakeAsk();
  const controller = createClientToolsController(read, ask);
  const abort = new AbortController();
  return { controller, abort, read, asks, setCurrent(value: BookingInvocation | undefined) { current = value; } };
}
afterEach(() => vi.useRealTimers());

describe('native five-tool business catalog', () => {
  it('constructs inertly and exposes exactly five authored schemas/policies', () => {
    const { controller, read, asks } = setup();
    expect(read).not.toHaveBeenCalled(); expect(asks).toHaveLength(0);
    expect(Object.keys(controller.tools)).toEqual(['get_weather', 'slow_status_check', 'weather_card', 'weather_snapshot', 'confirm_booking']);
    for (const tool of Object.values(controller.tools)) {
      expect(tool.parameters).toMatchObject({ type: 'object', additionalProperties: false });
      expect(tool.followUp).toBe(tool === controller.tools.weather_snapshot ? false : true);
    }
    expect(controller.tools.get_weather.description).toContain('simulated');
    expect(controller.tools.confirm_booking.description).toContain('fictional');
    expect(controller.tools.slow_status_check.parameters).toMatchObject({ required: [], properties: { label: { default: 'status check' } } });
    expect(controller.tools.weather_card.parameters).toEqual(controller.tools.weather_snapshot.parameters);
    expect(controller.tools.weather_card.parameters).toMatchObject({ required: Object.keys(weather) });
    controller.dispose();
  });
  it('returns asynchronous simulated data isolated across invocations and descriptors', async () => {
    const { controller, abort } = setup();
    const first = controller.tools.get_weather.handler({ location: 'Denver' }, abort);
    expect(first).toBeInstanceOf(Promise);
    const result = await first;
    expect(result).toEqual(weather);
    result.location = 'changed';
    expect(await controller.tools.get_weather.handler({ location: 'Denver' }, abort)).toEqual(weather);
    expect(Object.isFrozen(controller.tools.get_weather.parameters)).toBe(true);
    expect(Object.isFrozen(controller.tools.weather_card.parameters)).toBe(true);
    expect(Object.isFrozen(controller.tools)).toBe(true);
  });
  it('acknowledges both display tools with portable displayed:true without duplicating weather history', async () => {
    const { controller, abort } = setup();
    expect(await controller.tools.weather_card.handler(weather, abort)).toEqual({ displayed: true });
    expect(await controller.tools.weather_snapshot.handler(weather, abort)).toEqual({ displayed: true });
  });
  it.each([null, [], Object.create({ location: 'Denver' }), { location: '' }, { location: ' ' }, { location: 7 }, { location: 'Denver', extra: true }, Object.defineProperty({}, 'location', { get() { throw new Error('getter ran'); }, enumerable: true })])('rejects malformed location arguments case %# without reading getters', async (input: unknown) => {
    const { controller, abort } = setup();
    // Runtime admission is independently validated even if caller bypasses authored types.
    // @ts-expect-error deliberately malformed runtime arguments
    await expect(controller.tools.get_weather.handler(input, abort)).rejects.toThrow('Invalid tool arguments');
  });
  it.each([
    null, {}, { ...weather, conditions: '' }, { ...weather, temperatureF: Infinity },
    { ...weather, humidity: NaN }, { ...weather, humidity: -1 }, { ...weather, humidity: 101 },
    { ...weather, windMph: -1 }, { ...weather, temperatureF: '68' }, { ...weather, extra: 1 },
    Object.defineProperty({ ...weather }, 'conditions', { get() { throw new Error('getter ran'); } }),
    Object.assign(Object.create({}), weather),
  ])('rejects malformed complete weather case %# for both tools', async (input: unknown) => {
    const { controller, abort } = setup();
    for (const tool of [controller.tools.weather_card, controller.tools.weather_snapshot]) {
      // @ts-expect-error deliberately malformed runtime arguments
      await expect(tool.handler(input, abort)).rejects.toThrow('Invalid tool arguments');
    }
  });
  it('accepts weather bounds and rejects all work on cancelled/disposed ownership', async () => {
    const { controller, abort } = setup();
    expect(await controller.tools.weather_card.handler({ ...weather, humidity: 0, windMph: 0 }, abort)).toEqual({ displayed: true });
    expect(await controller.tools.weather_card.handler({ ...weather, humidity: 100 }, abort)).toEqual({ displayed: true });
    abort.abort();
    await expect(controller.tools.get_weather.handler({ location: 'Denver' }, abort)).rejects.toMatchObject({ name: 'AbortError' });
    await expect(controller.tools.weather_card.handler(weather, abort)).rejects.toMatchObject({ name: 'AbortError' });
    controller.dispose();
    await expect(controller.tools.weather_snapshot.handler(weather, new AbortController())).rejects.toMatchObject({ name: 'AbortError' });
  });
});

describe('owned slow delay', () => {
  it('waits exactly 3000ms with authored default and removes its listener on success', async () => {
    vi.useFakeTimers();
    const { controller, abort } = setup();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.slow_status_check.handler({}, abort);
    const settled = vi.fn(); void result.then(settled);
    await vi.advanceTimersByTimeAsync(2999); expect(settled).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toEqual({ label: 'status check', status: 'complete' });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['abort', 'dispose'] as const)('cleans pending delay on %s with no late result', async (action) => {
    vi.useFakeTimers();
    const { controller, abort } = setup();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.slow_status_check.handler({ label: 'Probe' }, abort);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(1000);
    if (action === 'abort') abort.abort(); else controller.dispose();
    await rejected;
    await vi.advanceTimersByTimeAsync(5000);
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('rejects already cancelled delay without creating a timer', async () => {
    vi.useFakeTimers(); const { controller, abort } = setup(); abort.abort();
    await expect(controller.tools.slow_status_check.handler({}, abort)).rejects.toMatchObject({ name: 'AbortError' });
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([null, { label: '' }, { label: undefined }, { label: 2 }, { extra: 1 }])('rejects malformed status case %# before scheduling', async (input: unknown) => {
    vi.useFakeTimers(); const { controller, abort } = setup();
    // @ts-expect-error deliberately malformed runtime arguments
    await expect(controller.tools.slow_status_check.handler(input, abort)).rejects.toThrow('Invalid tool arguments');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('fictional booking guarded by its native call', () => {
  const booking = { summary: invocation.summary };
  it('asks with the checked summary and returns each answer', async () => {
    for (const confirmed of [true, false]) {
      const { controller, abort, asks } = setup();
      const result = controller.tools.confirm_booking.handler(booking, abort);
      await vi.waitFor(() => expect(asks).toHaveLength(1));
      expect(asks[0].args).toEqual(booking);
      asks[0].resolve({ confirmed });
      expect(await result).toEqual({ confirmed });
    }
  });
  it('does not ask the same native booking again after cancellation', async () => {
    const { controller, abort, asks } = setup();
    const result = controller.tools.confirm_booking.handler(booking, abort);
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await cancelled;
    await expect(controller.tools.confirm_booking.handler(booking, new AbortController())).rejects.toThrow('Booking invocation unavailable');
    expect(asks).toHaveLength(1);
  });
  it('refuses a duplicate running booking and asks again for a new native call', async () => {
    const { controller, abort, asks, setCurrent } = setup();
    const first = controller.tools.confirm_booking.handler(booking, abort);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toThrow('Booking invocation unavailable');
    abort.abort(); await rejected;
    setCurrent({ ...invocation, ownerGeneration: 2, callId: 'fresh-call' });
    const fresh = controller.tools.confirm_booking.handler(booking, new AbortController());
    await vi.waitFor(() => expect(asks).toHaveLength(2));
    asks[1].resolve({ confirmed: true });
    expect(await fresh).toEqual({ confirmed: true });
  });
  it('does not ask for malformed arguments or a malformed native identity', async () => {
    const { controller, abort, asks } = setup();
    const malformed: unknown[] = [null, { summary: '' }, { summary: invocation.summary, extra: 1 },
      Object.defineProperty({}, 'summary', { get() { throw new Error('getter ran'); } })];
    for (const input of malformed) {
      // @ts-expect-error hostile runtime booking arguments
      await expect(controller.tools.confirm_booking.handler(input, abort)).rejects.toThrow('Invalid tool arguments');
    }
    expect(asks).toHaveLength(0);
    const other = fakeAsk();
    const invalid = createClientToolsController(() => Object.defineProperty({ ...invocation }, 'callId', { get() { throw new Error('getter ran'); } }), other.ask);
    await expect(invalid.tools.confirm_booking.handler(booking, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(other.asks).toHaveLength(0);
  });
  it.each([undefined, { ...invocation, summary: 'Different summary' }])('does not ask when the native call is unavailable or mismatched: %j', async (current) => {
    const { controller, abort, asks, setCurrent } = setup(); setCurrent(current);
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(asks).toHaveLength(0);
  });
  it.each(['ownerGeneration', 'sourceRunId'] as const)('does not ask for an unsafe %s identity', async (field) => {
    const { controller, abort, asks, setCurrent } = setup();
    setCurrent({ ...invocation, [field]: field === 'ownerGeneration' ? -1 : ' ' });
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(asks).toHaveLength(0);
  });
  it('reports a throwing native accessor as unavailable, and its cancellation as cancelled', async () => {
    const { controller, abort, asks, read } = setup();
    read.mockImplementationOnce(() => { throw new Error('native accessor failed'); });
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toThrow('Booking invocation unavailable');
    read.mockImplementationOnce(() => { abort.abort(); return invocation; });
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toMatchObject({ name: 'AbortError' });
    expect(asks).toHaveLength(0);
  });
  it.each(['abort', 'dispose'] as const)('revokes a waiting booking on %s, and nothing is asked afterwards', async (action) => {
    const { controller, abort, asks } = setup();
    const result = controller.tools.confirm_booking.handler(booking, abort);
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(asks).toHaveLength(1));
    expect(asks[0].signal.aborted).toBe(false);
    if (action === 'abort') abort.abort(); else controller.dispose();
    expect(asks[0].signal.aborted).toBe(true);
    await cancelled;
    asks[0].resolve({ confirmed: true });
    await expect(controller.tools.confirm_booking.handler(booking, abort)).rejects.toMatchObject({ name: 'AbortError' });
    expect(asks).toHaveLength(1);
    controller.dispose(); controller.dispose();
  });
});
