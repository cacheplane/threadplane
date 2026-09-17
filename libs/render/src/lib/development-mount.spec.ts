import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';
import * as telemetry from '@threadplane/telemetry/browser';
import { RenderSpecComponent } from './render-spec.component';
import { defineAngularRegistry } from './define-angular-registry';
import { signalStateStore } from './signal-state-store';
import { provideRender } from './provide-render';

@Component({
  standalone: true,
  template: '<span data-mounted>{{ label() }}</span>',
})
class MountedComponent {
  label = input<string>();
}
@Component({ standalone: true, template: '<span data-fallback>Loading</span>' })
class FallbackComponent {}

describe('development generative UI mount evidence', () => {
  let mounted: ReturnType<typeof vi.fn>;
  let touched: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mounted = vi.fn();
    touched = vi.fn();
    vi.spyOn(telemetry, 'createDevelopmentRuntime').mockImplementation(
      (options) => ({
        touch: () => {
          if (options.enabled?.() !== false) touched();
        },
        dispose: vi.fn(),
        milestone: (kind) => {
          if (options.enabled?.() !== false) mounted(kind);
        },
      })
    );
  });
  const spec = (extra = {}): Spec => ({
    root: 'root',
    elements: { root: { type: 'Text', props: { label: 'hello' }, ...extra } },
  });
  function fixture(value: Spec, enabled = true) {
    TestBed.configureTestingModule({
      imports: [RenderSpecComponent],
      providers: [
        {
          provide: telemetry.DEVELOPMENT_COLLECTION_POLICY,
          useValue: () => enabled,
        },
      ],
    });
    const fx = TestBed.createComponent(RenderSpecComponent);
    fx.componentRef.setInput('spec', value);
    fx.componentRef.setInput(
      'registry',
      defineAngularRegistry({
        Text: { component: MountedComponent, fallback: FallbackComponent },
      })
    );
    return fx;
  }
  it('records a real mounted outlet, without reporting received specs or repeated change detection', () => {
    const fx = fixture(spec());
    expect(mounted).not.toHaveBeenCalled();
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-mounted]')).toBeTruthy();
    expect(mounted).toHaveBeenCalledWith('generative_ui.rendered');
    fx.detectChanges();
    expect(mounted).toHaveBeenCalledTimes(1);
  });
  it.each(['unknown', 'hidden', 'unready', 'empty_repeat'])(
    'does not report %s elements',
    (reason) => {
      const value = spec(
        reason === 'unknown'
          ? { type: 'Unknown' }
          : reason === 'hidden'
          ? { visible: false }
          : reason === 'unready'
          ? { props: { label: { $state: '/missing' } } }
          : { repeat: { statePath: '/items' } }
      );
      const fx = fixture(value);
      fx.componentRef.setInput('store', signalStateStore({ items: [] }));
      fx.detectChanges();
      expect(fx.nativeElement.querySelector('[data-mounted]')).toBeFalsy();
      expect(mounted).not.toHaveBeenCalled();
    }
  );
  it('inherits parent runtime disable while allowing the component to mount', () => {
    const fx = fixture(spec(), false);
    fx.detectChanges();
    expect(fx.nativeElement.querySelector('[data-mounted]')).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
  });
  it('honors explicit render telemetry false', () => {
    const fx = fixture(spec());
    fx.componentRef.setInput('telemetry', false);
    fx.detectChanges();
    expect(mounted).not.toHaveBeenCalled();
  });
  it('honors provideRender telemetry false', () => {
    TestBed.configureTestingModule({
      providers: [provideRender({ telemetry: false })],
    });
    const fx = fixture(spec());
    fx.detectChanges();
    expect(mounted).not.toHaveBeenCalled();
  });
  it('reports a session when the element is constructed, before any mount', () => {
    const fx = fixture(spec());
    expect(mounted).not.toHaveBeenCalled();
    fx.detectChanges();
    expect(touched).toHaveBeenCalledTimes(1);
    fx.detectChanges();
    expect(touched).toHaveBeenCalledTimes(1);
  });
  it('does not report a session when the collection policy is disabled', () => {
    const fx = fixture(spec(), false);
    fx.detectChanges();
    expect(touched).not.toHaveBeenCalled();
  });
});
