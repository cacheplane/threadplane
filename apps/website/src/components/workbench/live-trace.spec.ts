import { describe, expect, it } from 'vitest';
import type { InspectionFrame } from '@threadplane/cockpit-runtime-bridge';
import {
  appendObservation,
  createLiveTrace,
  selectObservation,
  returnToLive,
} from './live-trace';

const frame = (sequence: number): InspectionFrame => ({
  sequence,
  elapsedMs: sequence,
  framework: 'react',
  messages: [],
  state: { busy: false },
  busy: false,
  calls: [],
  event: { type: 'snapshot', payload: null },
  limited: false,
});

describe('live observation history', () => {
  it('follows new frames until seeking, then preserves the selected identity', () => {
    let trace = appendObservation(createLiveTrace(), frame(1));
    trace = appendObservation(trace, frame(2));
    expect(trace.cursor).toBeNull();
    trace = selectObservation(trace, 1);
    trace = appendObservation(trace, frame(3));
    expect(trace.cursor).toBe(1);
    expect(returnToLive(trace).cursor).toBeNull();
  });

  it('bounds retained frames and honestly expires an evicted selection', () => {
    let trace = selectObservation(
      appendObservation(createLiveTrace(), frame(1)),
      1
    );
    for (let i = 2; i <= 202; i++) trace = appendObservation(trace, frame(i));
    expect(trace.frames).toHaveLength(200);
    expect(trace.dropped).toBe(2);
    expect(trace.expired).toBe(true);
    expect(trace.cursor).toBe(3);
    expect(returnToLive(trace).expired).toBe(false);
  });

  it('rejects duplicate sequence and caps encoded bytes as well as frame count', () => {
    let trace = appendObservation(createLiveTrace(), frame(1));
    expect(appendObservation(trace, frame(1))).toBe(trace);
    for (let i = 2; i < 200; i++)
      trace = appendObservation(trace, {
        ...frame(i),
        messages: [{ id: 'a', role: 'assistant', text: 'x'.repeat(60000) }],
      });
    expect(trace.bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
    expect(trace.frames.length).toBeLessThan(200);
  });
});
