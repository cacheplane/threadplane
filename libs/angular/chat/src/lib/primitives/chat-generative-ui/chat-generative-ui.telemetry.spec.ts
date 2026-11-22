import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Spec } from '@json-render/core';
import * as telemetry from '@threadplane/telemetry/browser/development';
import { defineAngularRegistry } from '@threadplane/angular/render';
import { ChatGenerativeUiComponent } from './chat-generative-ui.component';

@Component({ standalone: true, template: '<span data-mounted>{{ label() }}</span>' })
class MountedComponent {
  label = input<string>();
}

const spec: Spec = {
  root: 'root',
  elements: { root: { type: 'Text', props: { label: 'hello' } } },
} as Spec;

// The renderer chat defers carries no telemetry of its own; chat's generative
// UI supplies the bridge, so a spec it renders still reports.
describe('ChatGenerativeUiComponent telemetry bridge', () => {
  let create: ReturnType<typeof vi.spyOn>;
  let mounted: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mounted = vi.fn();
    create = vi.spyOn(telemetry, 'createDevelopmentRuntime').mockImplementation((options) => ({
      touch: vi.fn(),
      dispose: vi.fn(),
      milestone: (kind) => {
        if (options.enabled?.() !== false) mounted(kind);
      },
    }));
  });

  async function render(enabled: boolean) {
    TestBed.configureTestingModule({
      imports: [ChatGenerativeUiComponent],
      providers: [{ provide: telemetry.DEVELOPMENT_COLLECTION_POLICY, useValue: () => enabled }],
    });
    const fx = TestBed.createComponent(ChatGenerativeUiComponent);
    fx.componentRef.setInput('spec', spec);
    fx.componentRef.setInput('registry', defineAngularRegistry({ Text: MountedComponent }));
    fx.detectChanges();
    await fx.whenStable();
    fx.detectChanges();
    return fx;
  }

  it('creates the deferred renderer’s runtime through the bridge', async () => {
    const fx = await render(true);
    expect(fx.nativeElement.querySelector('[data-mounted]')).toBeTruthy();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ integration: 'render' }));
    expect(mounted).toHaveBeenCalledWith('generative_ui.rendered');
  });

  it('honors the surrounding collection policy', async () => {
    const fx = await render(false);
    expect(fx.nativeElement.querySelector('[data-mounted]')).toBeTruthy();
    expect(mounted).not.toHaveBeenCalled();
  });
});
