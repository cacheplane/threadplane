import { describe, expect, it } from 'vitest';
import { createPlayback, type FrameScheduler } from './playback';

function samples() {
  return [
    {
      label: 'First',
      json: JSON.stringify({
        root: 'root',
        elements: {
          root: {
            type: 'Heading',
            props: { content: 'First literal answer' },
            children: ['child'],
          },
          child: { type: 'Text', props: { content: 'Later child' } },
        },
      }),
    },
    {
      label: 'Second',
      json: JSON.stringify({
        root: 'root',
        elements: { root: { type: 'Card', props: { title: 'Second sample' } } },
      }),
    },
  ];
}

function frames() {
  let next = 0;
  const pending = new Map<number, FrameRequestCallback>();
  const all: FrameRequestCallback[] = [];
  const scheduler: FrameScheduler = {
    request(callback) {
      const id = ++next;
      pending.set(id, callback);
      all.push(callback);
      return id;
    },
    cancel(id) {
      pending.delete(id);
    },
  };
  return {
    scheduler,
    all,
    count: () => pending.size,
    tick() {
      const first = pending.entries().next().value;
      if (!first) throw Error('No current playback frame');
      pending.delete(first[0]);
      first[1](0);
    },
  };
}

describe('local parser playback ownership', () => {
  it('starts empty, stable and paused without scheduling work', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    const initial = store.getSnapshot();
    expect(initial).toMatchObject({
      selected: 0,
      label: 'First',
      position: 0,
      phase: 'paused',
      playing: false,
      rawJson: '',
      spec: null,
    });
    expect(initial.total).toBe(samples()[0].json.length);
    expect(store.getSnapshot()).toBe(initial);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(clock.count()).toBe(0);
  });

  it('publishes actual partial text and retains it immutably when paused', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    store.play();
    store.play();
    expect(clock.count()).toBe(1);
    let steps = 0;
    while (
      !store.getSnapshot().spec?.elements.root.props.content &&
      steps++ < samples()[0].json.length
    )
      clock.tick();
    const retained = store.getSnapshot();
    expect(retained.position).toBeGreaterThan(0);
    expect(retained.position).toBeLessThan(retained.total);
    expect(retained.spec?.elements.root.props.content).not.toBe(
      'First literal answer'
    );
    store.pause();
    const paused = store.getSnapshot();
    expect(paused.playing).toBe(false);
    expect(clock.count()).toBe(0);
    clock.all.at(-1)!(0);
    expect(store.getSnapshot()).toBe(paused);
    store.finish();
    expect(store.getSnapshot().phase).toBe('complete');
    expect(store.getSnapshot().spec?.elements.root.props.content).toBe(
      'First literal answer'
    );
    expect(retained.spec?.elements.root.props.content).not.toBe(
      'First literal answer'
    );
  });

  it('finishes through the real parser and owns its original source strings', () => {
    const borrowed = samples();
    const original = borrowed[0].json;
    const clock = frames();
    const store = createPlayback(borrowed, clock.scheduler);
    borrowed[0].json = samples()[1].json;
    borrowed[0].label = 'Replaced';
    store.finish();
    const final = store.getSnapshot();
    expect(final).toMatchObject({
      label: 'First',
      phase: 'complete',
      playing: false,
      rawJson: original,
      position: original.length,
    });
    expect(final.spec).toEqual(JSON.parse(original));
    expect(Object.isFrozen(final.spec?.elements)).toBe(true);
    expect(clock.count()).toBe(0);
  });

  it('rebuilds parser state on rewind and clamps finite seek positions', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    store.finish();
    store.seek(5.9);
    expect(store.getSnapshot()).toMatchObject({
      position: 5,
      spec: null,
      rawJson: samples()[0].json.slice(0, 5),
      phase: 'paused',
    });
    const current = store.getSnapshot();
    store.seek(Number.NaN);
    store.seek(Number.POSITIVE_INFINITY);
    expect(store.getSnapshot()).toBe(current);
    store.seek(10000);
    expect(store.getSnapshot().phase).toBe('complete');
    store.seek(-2);
    expect(store.getSnapshot()).toMatchObject({
      position: 0,
      spec: null,
      rawJson: '',
      phase: 'paused',
    });
  });

  it('revokes prior frames when switching samples and clearing playback', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    store.play();
    clock.tick();
    const stale = clock.all.at(-1)!;
    store.select(1);
    const empty = store.getSnapshot();
    stale(0);
    expect(store.getSnapshot()).toBe(empty);
    expect(empty).toMatchObject({
      selected: 1,
      label: 'Second',
      position: 0,
      spec: null,
      playing: false,
    });
    store.finish();
    expect(store.getSnapshot().spec?.elements.root.props.title).toBe(
      'Second sample'
    );
    store.reset();
    expect(store.getSnapshot()).toMatchObject({
      selected: 1,
      position: 0,
      spec: null,
    });
    expect(clock.count()).toBe(0);
  });

  it('replays a completed sample from zero through one current frame', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    store.finish();
    store.play();
    expect(store.getSnapshot()).toMatchObject({
      position: 0,
      playing: true,
      spec: null,
    });
    expect(clock.count()).toBe(1);
    let steps = 0;
    while (store.getSnapshot().playing && steps++ < samples()[0].json.length)
      clock.tick();
    expect(store.getSnapshot().phase).toBe('complete');
    expect(store.getSnapshot().rawJson).toBe(samples()[0].json);
    expect(clock.count()).toBe(0);
  });

  it('honors reentrant pause before scheduling the next frame', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    store.subscribe(() => {
      if (store.getSnapshot().playing) store.pause();
    });
    store.play();
    expect(store.getSnapshot().playing).toBe(false);
    expect(clock.count()).toBe(0);
  });

  it('honors reentrant sample selection during a parser publication', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    let switched = false;
    store.subscribe(() => {
      if (!switched && store.getSnapshot().position > 0) {
        switched = true;
        store.select(1);
      }
    });
    store.play();
    clock.tick();
    expect(store.getSnapshot()).toMatchObject({
      selected: 1,
      position: 0,
      playing: false,
      spec: null,
    });
    expect(clock.count()).toBe(0);
  });

  it('contains throwing subscribers and fences every action after disposal', () => {
    const clock = frames();
    const store = createPlayback(samples(), clock.scheduler);
    let updates = 0;
    store.subscribe(() => {
      throw Error('private listener');
    });
    store.subscribe(() => {
      updates++;
    });
    expect(() => store.play()).not.toThrow();
    clock.tick();
    expect(updates).toBeGreaterThan(0);
    const count = updates,
      retained = store.getSnapshot();
    store.dispose();
    const disposed = store.getSnapshot();
    expect(disposed.playing).toBe(false);
    for (const stale of clock.all) stale(0);
    store.play();
    store.pause();
    store.seek(9);
    store.select(1);
    store.finish();
    store.reset();
    store.dispose();
    expect(updates).toBe(count);
    expect(clock.count()).toBe(0);
    expect(store.getSnapshot()).toBe(disposed);
    expect(retained.position).toBeGreaterThan(0);
    let late = 0;
    store.subscribe(() => late++);
    expect(late).toBe(0);
  });

  it('rejects malformed complete samples before playing and permits a valid selection', () => {
    for (const json of [
      '{bad}',
      '{"root":invalid',
      samples()[0].json + ' trailing',
      'x'.repeat(16385),
    ]) {
      const clock = frames();
      const store = createPlayback(
        [{ label: 'Invalid', json }, samples()[1]],
        clock.scheduler
      );
      expect(store.getSnapshot()).toMatchObject({
        phase: 'error',
        playing: false,
        spec: null,
        rawJson: '',
      });
      store.play();
      expect(clock.count()).toBe(0);
      store.select(1);
      store.finish();
      expect(store.getSnapshot()).toMatchObject({
        phase: 'complete',
        label: 'Second',
      });
    }
  });
});
