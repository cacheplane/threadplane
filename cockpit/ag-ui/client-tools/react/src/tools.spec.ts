import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClientToolsController, type BookingInvocation } from './tools';

const weather = { location: 'Denver', temperatureF: 68, conditions: 'Sunny', humidity: 55, windMph: 8 };
const invocation: BookingInvocation = {
  ownerGeneration: 1, callId: 'call-real', assistantMessageId: 'assistant-real',
  sourceRunId: 'run-real', summary: 'Fictional Denver visit',
};
function setup() {
  let current: BookingInvocation | undefined = invocation;
  const read = vi.fn(() => current);
  const controller = createClientToolsController(read);
  const abort = new AbortController();
  return { controller, abort, read, setCurrent(value: BookingInvocation | undefined) { current = value; } };
}
afterEach(() => vi.useRealTimers());

describe('native five-tool business catalog', () => {
  it('constructs and subscribes inertly and exposes exactly five authored schemas/policies', () => {
    const { controller, read } = setup();
    const unsubscribe = controller.subscribe(() => undefined);
    expect(read).not.toHaveBeenCalled();
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
    unsubscribe(); controller.dispose();
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
    expect(controller.getSnapshot()).toEqual({ bookings: [] });
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

describe('identity-bound fictional booking decisions', () => {
  it('does not reconstruct the same native booking identity after cancellation', async () => {
    const { controller, abort } = setup();
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const cancelled = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    abort.abort(); await cancelled;
    await expect(controller.tools.confirm_booking.handler({ summary: invocation.summary }, new AbortController())).rejects.toThrow('Booking invocation unavailable');
    expect(controller.getSnapshot().bookings).toHaveLength(1);
  });
  it('does not grant a fresh controller authority to an old controller token', async () => {
    const old = setup(); const fresh = setup();
    const oldResult = old.controller.tools.confirm_booking.handler({ summary: invocation.summary }, old.abort);
    const cancelled = expect(oldResult).rejects.toMatchObject({ name: 'AbortError' });
    const oldToken = old.controller.getSnapshot().bookings[0].token;
    old.controller.dispose(); await cancelled;
    const result = fresh.controller.tools.confirm_booking.handler({ summary: invocation.summary }, fresh.abort);
    const newToken = fresh.controller.getSnapshot().bookings[0].token;
    expect(fresh.controller.respond(oldToken, true)).toBe(false);
    expect(fresh.controller.respond(newToken, false)).toBe(true);
    expect(await result).toEqual({ confirmed: false });
  });
  it('revokes acquisition when pending notification changes the actual current call', async () => {
    const { controller, abort, setCurrent } = setup();
    controller.subscribe(() => setCurrent(undefined));
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(controller.getSnapshot().bookings[0].status).toBe('aborted');
  });
  it('does not expose authority from malformed identity accessors or argument getters', async () => {
    const { controller, abort } = setup();
    const malformed: unknown[] = [null, { summary: '' }, { summary: invocation.summary, extra: 1 },
      Object.defineProperty({}, 'summary', { get() { throw new Error('getter ran'); } })];
    for (const input of malformed) {
      // @ts-expect-error hostile runtime booking arguments
      await expect(controller.tools.confirm_booking.handler(input, abort)).rejects.toThrow('Invalid tool arguments');
    }
    const invalid = createClientToolsController(() => Object.defineProperty({ ...invocation }, 'callId', { get() { throw new Error('getter ran'); } }));
    await expect(invalid.tools.confirm_booking.handler({ summary: invocation.summary }, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(invalid.getSnapshot().bookings).toEqual([]);
  });
  it('cannot acquire a duplicate running booking and cancelled controls stay distinct after a new generation', async () => {
    const { controller, abort, setCurrent } = setup();
    const first = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
    const old = controller.getSnapshot().bookings[0];
    await expect(controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort)).rejects.toThrow('Booking invocation unavailable');
    abort.abort(); await rejected;
    setCurrent({ ...invocation, ownerGeneration: 2, callId: 'fresh-call' });
    const fresh = controller.tools.confirm_booking.handler({ summary: invocation.summary }, new AbortController());
    const next = controller.getSnapshot().bookings[1];
    expect(next.token).not.toBe(old.token); expect(controller.respond(old.token, true)).toBe(false);
    expect(controller.respond(next.token, true)).toBe(true); expect(await fresh).toEqual({ confirmed: true });
  });
  it.each([true, false])('settles only the first explicit boolean %s and retains frozen visible result', async (decision) => {
    const { controller, abort } = setup();
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const pending = controller.getSnapshot().bookings[0];
    expect(pending).toMatchObject({ ...invocation, status: 'pending' });
    expect(Object.isFrozen(pending)).toBe(true);
    expect(Object.isFrozen(controller.getSnapshot().bookings)).toBe(true);
    expect(Object.isFrozen(controller.getSnapshot())).toBe(true);
    expect(controller.respond('wrong-token', decision)).toBe(false);
    expect(controller.respond(pending.token, decision)).toBe(true);
    expect(controller.respond(pending.token, !decision)).toBe(false);
    expect(await result).toEqual({ confirmed: decision });
    expect(controller.getSnapshot().bookings[0]).toMatchObject({ status: 'resolved', confirmed: decision });
    expect(Object.isFrozen(controller.getSnapshot().bookings[0])).toBe(true);
  });
  it.each([undefined, { ...invocation, summary: 'Different summary' }])('rejects unavailable or mismatched acquisition without publishing %j', async (current) => {
    const { controller, abort, setCurrent } = setup(); setCurrent(current);
    const notify = vi.fn(); controller.subscribe(notify);
    await expect(controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(controller.getSnapshot().bookings).toEqual([]); expect(notify).not.toHaveBeenCalled();
  });
  it.each(['ownerGeneration', 'callId', 'assistantMessageId', 'sourceRunId', 'summary'] as const)('refuses stale %s identities', async (field) => {
    const { controller, abort, setCurrent } = setup();
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const pending = controller.getSnapshot().bookings[0];
    setCurrent(field === 'ownerGeneration' ? { ...invocation, ownerGeneration: 2 } : { ...invocation, [field]: 'other' });
    expect(controller.respond(pending.token, true)).toBe(false);
    await rejected;
    setCurrent(invocation);
    expect(controller.respond(pending.token, true)).toBe(false);
    expect(controller.getSnapshot().bookings[0]).toMatchObject({ status: 'aborted' });
    expect(controller.getSnapshot().bookings[0]).not.toHaveProperty('confirmed');
  });
  it.each(['missing', 'throwing'] as const)('irreversibly revokes an owned token when the accessor is %s', async (mode) => {
    const { controller, abort, read, setCurrent } = setup();
    const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const token = controller.getSnapshot().bookings[0].token;
    if (mode === 'missing') setCurrent(undefined);
    else read.mockImplementationOnce(() => { throw new Error('native accessor failed'); });
    expect(controller.respond(token, true)).toBe(false);
    await rejected;
    setCurrent(invocation);
    expect(controller.respond(token, false)).toBe(false);
    expect(controller.getSnapshot().bookings[0]).toMatchObject({ status: 'aborted' });
    expect(controller.getSnapshot().bookings[0]).not.toHaveProperty('confirmed');
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
  it('rejects ambiguous acquisition represented by the native accessor returning undefined', async () => {
    const { controller, abort, setCurrent } = setup(); setCurrent(undefined);
    await expect(controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort)).rejects.toThrow('Booking invocation unavailable');
    expect(controller.getSnapshot().bookings).toEqual([]);
  });
  it.each(['abort', 'dispose'] as const)('revokes before another listener can respond during pending publication: %s', async (action) => {
    const { controller, abort } = setup();
    controller.subscribe(() => { if (action === 'abort') abort.abort(); else controller.dispose(); });
    const later = vi.fn(() => controller.respond(controller.getSnapshot().bookings[0].token, true));
    controller.subscribe(later);
    await expect(controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort)).rejects.toMatchObject({ name: 'AbortError' });
    const row = controller.getSnapshot().bookings[0];
    expect(row.status).toBe('aborted'); expect(row).not.toHaveProperty('confirmed');
    expect(controller.respond(row.token, false)).toBe(false);
    expect(later.mock.results.every((entry) => entry.value !== true)).toBe(true);
    controller.dispose(); controller.dispose();
  });
  it('rechecks cancellation caused by the accessor and by resolved publication', async () => {
    const abort = new AbortController(); let cancelOnRead = false;
    const controller = createClientToolsController(() => { if (cancelOnRead) abort.abort(); return invocation; });
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    const token = controller.getSnapshot().bookings[0].token; cancelOnRead = true;
    expect(controller.respond(token, true)).toBe(false); await rejected;
    const next = setup();
    next.controller.subscribe(() => { if (next.controller.getSnapshot().bookings[0]?.status === 'resolved') next.abort.abort(); });
    const pending = next.controller.tools.confirm_booking.handler({ summary: invocation.summary }, next.abort);
    const cancelled = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(next.controller.respond(next.controller.getSnapshot().bookings[0].token, true)).toBe(false);
    await cancelled; expect(next.controller.getSnapshot().bookings[0].status).toBe('aborted');
  });
  it('refuses nonboolean decisions without settling and removes booking abort listener on explicit resolution', async () => {
    const { controller, abort } = setup(); const remove = vi.spyOn(abort.signal, 'removeEventListener');
    const result = controller.tools.confirm_booking.handler({ summary: invocation.summary }, abort);
    const token = controller.getSnapshot().bookings[0].token;
    // @ts-expect-error runtime control input must be boolean
    expect(controller.respond(token, 'yes')).toBe(false);
    expect(controller.respond(token, false)).toBe(true); expect(await result).toEqual({ confirmed: false });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
