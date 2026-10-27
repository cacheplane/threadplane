import { describe, it, expect, vi } from 'vitest';
import type { BaseEvent } from '@ag-ui/client';
import { Subject } from 'rxjs';
import { collectReplay, httpReplay } from './replay';

const events = [{ type: 'RUN_STARTED', threadId: 't1', runId: 'r1' }, { type: 'RUN_FINISHED', threadId: 't1', runId: 'r1' }];

describe('httpReplay', () => {
  it('GETs the thread URL with the configured headers and returns its events', async () => {
    const fetch = vi.fn(async () => Response.json({ events }));
    const replay = httpReplay({ url: id => `/threads/${id}/events`, fetch, headers: { authorization: 'Bearer test' } });
    const signal = new AbortController().signal;
    await expect(replay('t1', signal)).resolves.toEqual(events);
    expect(fetch).toHaveBeenCalledWith('/threads/t1/events', {
      method: 'GET', headers: { accept: 'application/json', authorization: 'Bearer test' }, signal,
    });
  });

  it('resolves a 404 to no events', async () => {
    const fetch = vi.fn(async () => new Response('not found', { status: 404 }));
    await expect(httpReplay({ url: () => '/x', fetch })('t1', new AbortController().signal)).resolves.toEqual([]);
  });

  it('rejects any other failed status', async () => {
    const fetch = vi.fn(async () => new Response('boom', { status: 500 }));
    await expect(httpReplay({ url: () => '/x', fetch })('t1', new AbortController().signal)).rejects.toThrow(/500/);
  });

  it('rejects a body without an events array, or an event without a type', async () => {
    const signal = new AbortController().signal;
    await expect(httpReplay({ url: () => '/x', fetch: async () => Response.json([]) })('t1', signal)).rejects.toThrow(/events array/);
    await expect(httpReplay({ url: () => '/x', fetch: async () => Response.json({ events: [{}] }) })('t1', signal)).rejects.toThrow(/string type/);
  });
});

describe('collectReplay', () => {
  it('collects an Observable until it completes', async () => {
    const subject = new Subject<BaseEvent>();
    const result = collectReplay(() => subject, 't1', new AbortController().signal);
    for (const event of events) subject.next(event as BaseEvent);
    subject.complete();
    await expect(result).resolves.toEqual(events);
  });

  it('rejects with an AbortError and unsubscribes when aborted', async () => {
    const subject = new Subject<BaseEvent>();
    const controller = new AbortController();
    const result = collectReplay(() => subject, 't1', controller.signal);
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(subject.observed).toBe(false);
  });

  it('rejects a source that throws synchronously or resolves to a non-array', async () => {
    const signal = new AbortController().signal;
    await expect(collectReplay(() => { throw new Error('sync'); }, 't1', signal)).rejects.toThrow('sync');
    await expect(collectReplay(async () => ({}) as never, 't1', signal)).rejects.toThrow(/array/);
  });
});
