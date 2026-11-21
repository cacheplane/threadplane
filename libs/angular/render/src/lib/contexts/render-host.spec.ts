import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { RENDER_HOST, injectRenderHost, type RenderHost } from './render-host';

@Component({ standalone: true, template: '' })
class HostConsumer {
  readonly host = injectRenderHost();
}

describe('injectRenderHost', () => {
  it('returns the provided RENDER_HOST', () => {
    const calls: unknown[] = [];
    const fake: RenderHost = {
      set: (p, v) => calls.push(['set', p, v]),
      emit: (e, payload) => calls.push(['emit', e, payload]),
      result: (v) => calls.push(['result', v]),
    };
    TestBed.configureTestingModule({
      imports: [HostConsumer],
      providers: [{ provide: RENDER_HOST, useValue: fake }],
    });
    const fx = TestBed.createComponent(HostConsumer);
    fx.componentInstance.host.set('/x', 1);
    fx.componentInstance.host.result({ ok: true });
    expect(calls).toEqual([['set', '/x', 1], ['result', { ok: true }]]);
  });
});
