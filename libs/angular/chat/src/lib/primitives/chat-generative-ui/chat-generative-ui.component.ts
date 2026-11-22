// libs/angular/chat/src/lib/primitives/chat-generative-ui/chat-generative-ui.component.ts
import {
  Component,
  computed,
  effect,
  input,
  output,
  inject,
  untracked,
  ChangeDetectionStrategy,
} from '@angular/core';
import type { Spec, StateStore } from '@json-render/core';
import type { AngularRegistry, RenderEvent } from '@threadplane/angular/render';
import { ɵRenderSpecCore as RenderSpecCore } from '@threadplane/angular/render/deferred';
import { ɵRENDER_TELEMETRY as RENDER_TELEMETRY } from '@threadplane/angular/render/registry';
import { createDevelopmentRuntime, DEVELOPMENT_COLLECTION_POLICY } from '@threadplane/telemetry/browser/development';
import { CHAT_HOST_TOKENS } from '../../styles/chat-tokens';
import { CHAT_GENERATIVE_UI_STYLES } from '../../styles/chat-generative-ui.styles';
import { normalizeJsonRenderSpec } from './normalize-json-render-spec';
import { ɵprovideRenderDevtools } from '../../devtools/devtools-render-report';
import { injectChatRuntime } from '../../styles/chat-runtime';

/** Renders a normalized json-render specification with optional registry, state store, and event handlers. */
@Component({
  selector: 'chat-generative-ui',
  standalone: true,
  imports: [RenderSpecCore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [CHAT_HOST_TOKENS, CHAT_GENERATIVE_UI_STYLES],
  // The renderer loads on demand without its telemetry bridge; this supplies
  // it, so the runtime ships only with an application that renders specs.
  providers: [
    {
      provide: RENDER_TELEMETRY,
      useFactory: () => ({
        policy: inject(DEVELOPMENT_COLLECTION_POLICY, { optional: true }),
        createRuntime: (options: Parameters<typeof createDevelopmentRuntime>[0]) => createDevelopmentRuntime(options),
      }),
    },
  ],
  // Development only: the AG-UI DevTools render report, as 'spec:' + root key.
  viewProviders: [ɵprovideRenderDevtools()],
  template: `
    @if (normalizedSpec()) {
      @defer (on immediate) {
        <render-spec
          [spec]="normalizedSpec()"
          [registry]="registry()"
          [store]="store()"
          [handlers]="handlers()"
          [loading]="loading()"
          (events)="events.emit($event)"
        />
      }
    }
  `,
})
export class ChatGenerativeUiComponent {
  protected readonly chatRuntime = injectChatRuntime();
  readonly spec = input<Spec | null>(null);
  readonly registry = input<AngularRegistry | undefined>(undefined);
  readonly store = input<StateStore | undefined>(undefined);
  readonly handlers = input<Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>> | undefined>(undefined);
  readonly loading = input<boolean>(false);
  readonly events = output<RenderEvent>();

  /** The bound spec with schema-documented `{ statePath }` prop refs
   * rewritten to engine-native `{ $bindState }` + `_bindings` so values
   * resolve against the state store instead of interpolating as
   * "[object Object]" (F4). */
  protected readonly normalizedSpec = computed(() => {
    const s = this.spec();
    return s ? normalizeJsonRenderSpec(s) : null;
  });

  /** Last value this component seeded per state path. Lets the seeding
   * effect distinguish "still the value we wrote (possibly a partial
   * chunk from streaming — safe to overwrite with the newer one)" from
   * "user edited it via a bound control — leave it alone". */
  private readonly seeded = new Map<string, unknown>();

  constructor() {
    // Seed `spec.state` (the schema's "initial state model") into an
    // EXPLICIT consumer-provided store, which is typically EMPTY at first —
    // without this, statePath/$bindState props would resolve to undefined.
    // A consumer-provided store intentionally has shared/live semantics
    // across surfaces: every surface bound to it reads (and writes) the same
    // state, so the first surface to seed a path wins. When NO store input
    // is given, this effect is a no-op and render-spec self-seeds its own
    // per-instance internal store from spec.state, keeping surfaces with
    // overlapping state keys isolated from each other (a2ui parity).
    effect(() => {
      const s = this.spec();
      const store = this.store();
      const state = s?.state as Record<string, unknown> | undefined;
      if (!state || !store) return;
      // Untracked: store reads/writes must not become dependencies — the
      // effect re-runs on spec/store-identity changes only, not on every
      // write to the (possibly shared) store.
      untracked(() => {
        for (const [key, value] of Object.entries(state)) {
          const path = key.startsWith('/') ? key : `/${key}`;
          const current = store.get(path);
          const untouched =
            current === undefined ||
            (this.seeded.has(path) && current === this.seeded.get(path));
          if (untouched) {
            if (current !== value) store.set(path, value);
            this.seeded.set(path, value);
          }
        }
      });
    });
  }
}
