import {
  Component,
  createEnvironmentInjector,
  EnvironmentInjector,
  inject,
  InjectionToken,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { observeAgent } from './public-api';
// eslint-disable-next-line @nx/enforce-module-boundaries -- Only this integration spec composes the private runtime; production imports core only.
import {
  bindingFixture,
  changed,
  delta,
  finalText,
  weatherCall,
} from '../../langgraph/src/runtime/testing/binding-fixture';

const fixtures: ReturnType<typeof bindingFixture>[] = [];
const injectors: EnvironmentInjector[] = [];
const SESSION = new InjectionToken<
  ReturnType<typeof bindingFixture>['session']
>('test session');

@Component({
  selector: 'test-agent',
  template: `
    <button (click)="send()">Send</button>
    <button (click)="stop()">Stop</button>
    <output data-testid="status">{{ snapshot().status }}</output>
    <div data-testid="messages">{{ messages }}</div>
    <div data-testid="delivery">{{ delivery }}</div>
    <div data-testid="tools">{{ tools }}</div>
    <div role="alert">{{ snapshot().error?.message }}</div>
  `,
})
class Chat {
  readonly session = inject(SESSION);
  readonly snapshot = observeAgent(this.session);
  run?: ReturnType<typeof this.session.submit>;
  send() {
    this.run = this.session.submit('Hello');
  }
  stop() {
    void this.session.stop();
  }
  get messages() {
    return this.snapshot()
      .messages.map((message) => message.content)
      .join('\n');
  }
  get delivery() {
    return JSON.stringify(this.snapshot().messages.at(-1)?.delivery);
  }
  get tools() {
    return JSON.stringify(this.snapshot().toolCalls);
  }
}
function fixture() {
  const value = bindingFixture();
  fixtures.push(value);
  return value;
}
function observe(session: ReturnType<typeof bindingFixture>['session']) {
  const injector = createEnvironmentInjector(
    [],
    TestBed.inject(EnvironmentInjector)
  );
  injectors.push(injector);
  return {
    snapshot: runInInjectionContext(injector, () => observeAgent(session)),
    destroy: () => injector.destroy(),
  };
}
afterEach(async () => {
  injectors.splice(0).forEach((injector) => {
    if (!injector.destroyed) injector.destroy();
  });
  await Promise.all(fixtures.splice(0).map((value) => value.cleanup()));
  TestBed.resetTestingModule();
});

describe('observeAgent borrowed session', () => {
  it('observes explicit history loads without owning reads, refreshes, or teardown', async () => {
    const f = fixture();
    TestBed.configureTestingModule({
      imports: [Chat],
      providers: [{ provide: SESSION, useValue: f.session }],
    });
    const view = TestBed.createComponent(Chat);
    view.detectChanges();
    expect(f.session.load).toBeTypeOf('function');
    expect(f.history.reads).toBe(0);
    let notifications = 0;
    const release = f.session.subscribe(() => { notifications++; });
    await f.session.load();
    view.detectChanges();
    expect(view.nativeElement.querySelector('[data-testid="messages"]').textContent).toBe('Saved question\nSaved answer');
    const snapshot = view.componentInstance.snapshot();
    await f.session.load();
    expect(view.componentInstance.snapshot()).toBe(snapshot);
    expect(notifications).toBe(1);
    expect(f.history.reads).toBe(2);
    release();
    view.destroy();
    const reattached = observe(f.session);
    expect(reattached.snapshot()).toBe(snapshot);
    expect(f.history.reads).toBe(2);
    reattached.destroy();
    f.history.value = [];
    await f.session.load();
    expect(f.session.getSnapshot().messages).toEqual([]);
    expect(f.history.reads).toBe(3);
    expect(f.handlerCalls).toBe(0);
    expect(f.streams).toHaveLength(0);
    expect(f.session.submitCalls + f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('renders streamed text, tool results, errors and stop outcomes through native controls', async () => {
    const f = fixture();
    TestBed.configureTestingModule({
      imports: [Chat],
      providers: [{ provide: SESSION, useValue: f.session }],
    });
    const view = TestBed.createComponent(Chat);
    view.detectChanges();
    const element: HTMLElement = view.nativeElement;
    const text = (selector: string) =>
      element.querySelector(selector)?.textContent;
    const send = () => element.querySelectorAll('button')[0].click();
    expect(text('[data-testid="status"]')).toBe('idle');
    expect(f.streams).toHaveLength(0);
    send();
    await f.started();
    view.detectChanges();
    expect(text('[data-testid="status"]')).toBe('running');
    const partial = changed(
      f.session,
      (s) => s.messages.at(-1)?.content === 'Visible partial'
    );
    f.streams[0].release(delta('Visible partial'));
    await partial;
    view.detectChanges();
    expect(text('[data-testid="messages"]')).toContain('Visible partial');
    expect(text('[data-testid="delivery"]')).toContain('streaming');
    f.streams[0].release(finalText('Visible final'));
    f.streams[0].finish();
    expect(await view.componentInstance.run).toBe('success');
    view.detectChanges();
    expect(text('[data-testid="messages"]')).toContain('Visible final');
    expect(text('[data-testid="status"]')).toBe('idle');
    expect(text('[data-testid="delivery"]')).toContain('success');

    send();
    await f.started(1);
    f.streams[1].release(weatherCall);
    f.streams[1].finish();
    await f.entered;
    view.detectChanges();
    expect(text('[data-testid="tools"]')).toContain('running');
    f.toolResult.resolve({ temperature: 24 });
    await f.started(2);
    f.streams[2].release(finalText('24 degrees'));
    f.streams[2].finish();
    expect(await view.componentInstance.run).toBe('success');
    view.detectChanges();
    expect(text('[data-testid="tools"]')).toContain('"temperature":24');
    expect(text('[data-testid="messages"]')).toContain('24 degrees');

    send();
    await f.started(3);
    f.streams[3].release({ type: 'error', data: { message: 'Unavailable' } });
    expect(await view.componentInstance.run).toBe('error');
    view.detectChanges();
    expect(text('[data-testid="status"]')).toBe('error');
    expect(text('[role="alert"]')).toBeTruthy();
    send();
    await f.started(4);
    const stopping = changed(
      f.session,
      (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
    );
    f.streams[4].release(delta('Stopping', 'stopped-answer'));
    await stopping;
    element.querySelectorAll('button')[1].click();
    expect(await view.componentInstance.run).toBe('aborted');
    view.detectChanges();
    expect(text('[data-testid="status"]')).toBe('idle');
    expect(text('[data-testid="delivery"]')).toContain('aborted');
    expect(f.handlerCalls).toBe(1);
    expect(f.session.submitCalls).toBe(4);
    expect(f.streams).toHaveLength(5);
    expect(f.session.stopCalls).toBe(1);
    view.destroy();
    expect(f.session.disposeCalls).toBe(0);
    expect(f.session.subscriptions).toBe(f.session.releases);
  });

  it('reads inertly and releases its subscription through the injected DestroyRef', () => {
    const f = fixture();
    const view = observe(f.session);
    expect(view.snapshot()).toBe(f.session.getSnapshot());
    expect(view.snapshot()).toBe(view.snapshot());
    expect(f.session.subscriptions).toBe(1);
    view.destroy();
    expect(f.session.releases).toBe(1);
    expect(
      f.session.submitCalls + f.session.stopCalls + f.session.disposeCalls
    ).toBe(0);
    expect(f.streams).toHaveLength(0);
  });

  it('requires an injection context before subscribing', () => {
    const f = fixture();
    expect(() => observeAgent(f.session)).toThrow(/NG0203/);
    expect(f.session.subscriptions).toBe(0);
  });

  it('shares intermediate and final snapshots between two simultaneous observers', async () => {
    const f = fixture();
    const first = observe(f.session);
    const second = observe(f.session);
    const run = f.session.submit('Hello');
    await f.started();
    expect(first.snapshot().status).toBe('running');
    const observed = changed(
      f.session,
      (s) => s.messages.at(-1)?.content === 'Hel'
    );
    f.streams[0].release(delta('Hel'));
    await observed;
    expect(first.snapshot().messages.at(-1)?.content).toBe('Hel');
    expect(first.snapshot()).toBe(second.snapshot());
    const detached = first.snapshot();
    first.destroy();
    f.streams[0].release(finalText('Hello world'));
    f.streams[0].finish();
    expect(await run).toBe('success');
    expect(first.snapshot()).toBe(detached);
    expect(second.snapshot()).toBe(f.session.getSnapshot());
    expect(second.snapshot().status).toBe('idle');
    expect(second.snapshot().messages.at(-1)).toMatchObject({
      content: 'Hello world',
      delivery: { phase: 'complete', outcome: 'success' },
    });
    expect(f.session.submitCalls).toBe(1);
    expect(f.streams).toHaveLength(1);
    expect(f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('keeps a pending tool alive after destruction and reattaches without executing it again', async () => {
    const f = fixture();
    const first = observe(f.session);
    const run = f.session.submit('Weather');
    await f.started();
    f.streams[0].release(weatherCall);
    f.streams[0].finish();
    await f.entered;
    expect(first.snapshot().toolCalls[0]).toMatchObject({
      name: 'weather',
      status: 'running',
    });
    first.destroy();
    expect(f.handlerSignal?.aborted).toBe(false);
    const second = observe(f.session);
    expect(second.snapshot().toolCalls[0].status).toBe('running');
    f.toolResult.resolve({ temperature: 24 });
    await f.started(1);
    f.streams[1].release(finalText('24 degrees'));
    f.streams[1].finish();
    expect(await run).toBe('success');
    expect(second.snapshot().toolCalls[0]).toMatchObject({
      name: 'weather',
      args: { city: 'Paris' },
      status: 'complete',
      result: { temperature: 24 },
    });
    expect(second.snapshot().messages.at(-1)?.content).toBe('24 degrees');
    expect(f.handlerCalls).toBe(1);
    expect(f.session.submitCalls).toBe(1);
    expect(f.streams).toHaveLength(2);
    expect(f.session.stopCalls + f.session.disposeCalls).toBe(0);
  });

  it('publishes runtime errors and a later app-owned stop', async () => {
    const f = fixture();
    const view = observe(f.session);
    const failed = f.session.submit('Fail');
    await f.started();
    const partial = changed(
      f.session,
      (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
    );
    f.streams[0].release(delta('Partial'));
    await partial;
    f.streams[0].release({ type: 'error', data: { message: 'Unavailable' } });
    expect(await failed).toBe('error');
    expect(view.snapshot().status).toBe('error');
    expect(view.snapshot().error).toBeDefined();
    expect(view.snapshot().messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'error',
    });
    const stopped = f.session.submit('Stop');
    await f.started(1);
    const stopping = changed(
      f.session,
      (s) => s.messages.at(-1)?.delivery.phase === 'streaming'
    );
    f.streams[1].release(delta('Stopping', 'stopped-answer'));
    await stopping;
    await f.session.stop();
    expect(await stopped).toBe('aborted');
    expect(view.snapshot().status).toBe('idle');
    expect(view.snapshot().messages.at(-1)?.delivery).toMatchObject({
      phase: 'complete',
      outcome: 'aborted',
    });
    expect(f.session.submitCalls).toBe(2);
    expect(f.session.stopCalls).toBe(1);
    expect(f.session.disposeCalls).toBe(0);
  });
});
