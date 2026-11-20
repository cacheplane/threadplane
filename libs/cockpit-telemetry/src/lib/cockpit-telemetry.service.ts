import { Injectable, inject, effect, untracked, Injector, runInInjectionContext } from '@angular/core';
import posthog from 'posthog-js';
import { COCKPIT_TELEMETRY_CONFIG } from './tokens';
import { ActivationAggregator } from './activation-aggregator';
import { CHAT_LIFECYCLE } from '@threadplane/chat';
import { AgentLifecycleRegistry, type AgentLifecycle } from '@threadplane/angular';
import { RENDER_LIFECYCLE } from '@threadplane/render';
import type { CockpitEventName } from './events';

@Injectable()
export class CockpitTelemetryService {
  private config = inject(COCKPIT_TELEMETRY_CONFIG);
  private injector = inject(Injector);
  private aggregator = inject(ActivationAggregator);
  private initialized = false;

  init(): void {
    if (this.initialized) return;
    this.initialized = true;

    posthog.init(this.config.posthogKey, {
      api_host: this.config.posthogHost ?? 'https://us.i.posthog.com',
      persistence: 'memory',
      bootstrap: { distinctID: this.config.distinctId },
      autocapture: false,
      capture_pageview: false,
      // This client only sends explicit lifecycle events. Optional downloaded
      // features are unnecessary and conflict with the embedded runtime CSP.
      advanced_disable_flags: true,
      disable_surveys: true,
      disable_session_recording: true,
      disable_external_dependency_loading: true,
    });

    this.subscribeChat();
    this.subscribeAgent();
    this.subscribeRender();
  }

  private subscribeChat(): void {
    const chat = this.injector.get(CHAT_LIFECYCLE, null, { optional: true });
    if (!chat) return;
    let fired = false;
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (chat.firstMessageSent() && !fired) {
          fired = true;
          this.capture('cockpit:chat_first_message');
          this.aggregator.markSignal('chat_first_message');
        }
      });
    });
  }

  private subscribeAgent(): void {
    const registry = this.injector.get(AgentLifecycleRegistry, null, { optional: true });
    if (!registry) return;

    // Track subscribed lifecycles so we don't double-subscribe on re-registration.
    const subscribed = new WeakSet<AgentLifecycle>();

    runInInjectionContext(this.injector, () => {
      effect(() => {
        const lifecycles = registry.lifecycles();
        // Creating new effects must happen outside the reactive read context;
        // `untracked()` opts the effect-creation calls out of dependency
        // tracking (and out of the "no effect inside reactive context" check).
        untracked(() => {
          for (const lifecycle of lifecycles) {
            if (subscribed.has(lifecycle)) continue;
            subscribed.add(lifecycle);
            this.subscribeOneAgent(lifecycle);
          }
        });
      });
    });
  }

  private subscribeOneAgent(agent: AgentLifecycle): void {
    let transportFired = false;
    let threadFired = false;
    let interruptFired = false;
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (agent.streamStartedAt() !== null && !transportFired) {
          transportFired = true;
          this.capture('cockpit:transport_connected');
          this.aggregator.markSignal('transport_connected');
        }
      });
      effect(() => {
        if (agent.threadPersistedAt() !== null && !threadFired) {
          threadFired = true;
          this.capture('cockpit:thread_persisted');
          this.aggregator.markSignal('thread_persisted');
        }
      });
      effect(() => {
        if (agent.interruptResolvedAt() !== null && !interruptFired) {
          interruptFired = true;
          this.capture('cockpit:interrupt_handled');
          this.aggregator.markSignal('interrupt_handled');
        }
      });
    });
  }

  private subscribeRender(): void {
    const render = this.injector.get(RENDER_LIFECYCLE, null, { optional: true });
    if (!render) return;
    let fired = false;
    runInInjectionContext(this.injector, () => {
      effect(() => {
        if (render.firstMountAt() !== null && !fired) {
          fired = true;
          this.capture('cockpit:generative_component_rendered');
          this.aggregator.markSignal('generative_component_rendered');
        }
      });
    });
  }

  private capture(event: CockpitEventName, properties: Record<string, unknown> = {}): void {
    try {
      posthog.capture(event, { ...properties, capability: this.config.capabilitySlug });
    } catch {
      // silent fail
    }
  }
}
