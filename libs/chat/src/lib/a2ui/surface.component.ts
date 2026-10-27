import {
  Component, computed, effect, inject, input, output, untracked, ChangeDetectionStrategy, Type,
} from '@angular/core';
import { NgComponentOutlet } from '@angular/common';
import type { A2uiSurface, A2uiActionMessage, A2uiErrorMessage, A2uiCheck } from '@threadplane/a2ui';
import {
  A2UI_WIRE_VERSION, createA2uiFunctionRegistry, getByPointer, isPathRef, resolveDynamic,
} from '@threadplane/a2ui';
import { RenderSpecComponent, toRenderRegistry, signalStateStore } from '@threadplane/render';
import type { ViewRegistry, RenderEvent } from '@threadplane/render';
import { surfaceToSpec, componentHasChecks } from './surface-to-spec';
import { buildA2uiActionMessage } from './build-action-message';
import { A2uiDefaultFallbackComponent } from './a2ui-default-fallback.component';
import type { A2uiSurfaceState } from './surface-store';
import type { A2uiViews } from './views';
import { ɵprovideRenderDevtools } from '../devtools/devtools-render-report';

@Component({
  selector: 'a2ui-surface',
  standalone: true,
  imports: [
    RenderSpecComponent,
    A2uiDefaultFallbackComponent,
    NgComponentOutlet,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Development only: the AG-UI DevTools render report, keyed by surfaceId.
  viewProviders: [
    ɵprovideRenderDevtools(() => {
      const host = inject(A2uiSurfaceComponent);
      return () => (host.state()?.surface ?? host.surface())?.surfaceId;
    }),
  ],
  // The host applies the agent-set surface theme (`createSurface.theme`)
  // as inline CSS custom properties. Catalog components consume
  // `--a2ui-primary` for accents (buttons, sliders, focus, etc.).
  host: {
    '[style.--a2ui-primary]': 'primaryColor()',
  },
  styles: `
    .a2ui-surface-chrome {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-2);
      margin-bottom: var(--a2ui-spacing-2);
      color: var(--a2ui-label);
      font-size: var(--a2ui-typography-label-size);
    }
    .a2ui-surface-chrome img {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      object-fit: cover;
    }
  `,
  template: `
    @if (agentDisplayName() || iconUrl()) {
      <div class="a2ui-surface-chrome">
        @if (iconUrl(); as icon) {
          <img [src]="icon" alt="" referrerpolicy="no-referrer" />
        }
        @if (agentDisplayName(); as name) {
          <span>{{ name }}</span>
        }
      </div>
    }
    @if (spec(); as s) {
      <render-spec
        [spec]="s"
        [registry]="registry()"
        [store]="liveStore"
        [handlers]="internalHandlers()"
        (events)="onRenderEvent($event)"
      />
    } @else if (state(); as st) {
      @if (surfaceFallback(); as fb) {
        <ng-container *ngComponentOutlet="fb" />
      } @else {
        <a2ui-default-fallback />
      }
    }
  `,
})
/**
 * Renders an A2UI surface. Supports two input shapes:
 * - `state` (preferred): chat-side `A2uiSurfaceState`, converted to a
 *   json-render spec whose `$bindState` props defer each component until
 *   its data has arrived.
 * - `surface` (legacy): wire-format `A2uiSurface` fed into `<render-spec>`;
 *   kept for backwards compatibility.
 *
 * When both inputs are set, `state` takes priority for rendering AND for
 * action-message construction; `surface` is only consulted when `state`
 * is unset.
 */
export class A2uiSurfaceComponent {
  /** Wire-format surface (legacy path — kept for backwards compat). */
  readonly surface = input<A2uiSurface>();
  /** Chat-side surface state with per-component readiness. When set,
   * this takes priority and the progressive renderer is used. */
  readonly state = input<A2uiSurfaceState>();
  readonly catalog = input.required<A2uiViews | ViewRegistry>();
  readonly handlers = input<Record<string, (params: Record<string, unknown>) => unknown | Promise<unknown>>>({});
  /** Optional top-level placeholder when the surface has no components
   * yet. Defaults to A2uiDefaultFallbackComponent. */
  readonly surfaceFallback = input<Type<unknown> | undefined>(undefined);
  readonly events = output<RenderEvent>();
  readonly action = output<A2uiActionMessage>();
  /** Emitted when a submit is blocked by failing validation checks —
   * the spec client → agent error message (code VALIDATION_FAILED). */
  readonly validationError = output<A2uiErrorMessage>();

  /** Surface-owned live state store: `$bindState` props read it and input
   * components write user edits into it, so event-time logic (checks,
   * action context) sees CURRENT values instead of the agent-seeded
   * snapshot. Seeded from spec.state with user edits preserved. Public so
   * hosts (and tests) can read the live values of a rendered surface. */
  readonly liveStore = signalStateStore({});

  /** Last value this component seeded per state path (see chat-generative-ui:
   * distinguishes "still our seed — safe to overwrite" from "user edited"). */
  private readonly seeded = new Map<string, unknown>();

  constructor() {
    effect(() => {
      const s = this.spec();
      const state = s?.state as Record<string, unknown> | undefined;
      if (!state) return;
      untracked(() => {
        for (const [key, value] of Object.entries(state)) {
          const path = key.startsWith('/') ? key : `/${key}`;
          const current = this.liveStore.get(path);
          const untouched =
            current === undefined ||
            (this.seeded.has(path) && current === this.seeded.get(path));
          if (untouched) {
            if (current !== value) this.liveStore.set(path, value);
            this.seeded.set(path, value);
          }
        }
      });
    });
  }

  /** Agent-set primary color from `createSurface.theme.primaryColor`.
   * Returns null when unset so the host binding doesn't override the
   * consumer's `:root`-level `--a2ui-primary` default. */
  readonly primaryColor = computed<string | null>(() =>
    (this.state()?.surface ?? this.surface())?.theme?.primaryColor ?? null
  );

  /** Agent identity chrome from `createSurface.theme`. When neither
   * `agentDisplayName` nor `iconUrl` is set, no header renders at all
   * (zero layout impact for themeless surfaces — the common case). */
  protected readonly agentDisplayName = computed<string | null>(() =>
    (this.state()?.surface ?? this.surface())?.theme?.agentDisplayName ?? null
  );
  protected readonly iconUrl = computed<string | null>(() =>
    (this.state()?.surface ?? this.surface())?.theme?.iconUrl ?? null
  );

  /** Roots from the surface state. The v0.9 wire contract reserves the
   * component id `root` as the single tree root; we keep the renderer
   * permissive in case future surfaces emit multiple top-level
   * components.
   *
   * Conservative: returns only the first key from componentViews
   * insertion order. */
  readonly rootIds = computed<string[]>(() => {
    const st = this.state();
    if (!st) return [];
    return [...st.componentViews.keys()].slice(0, 1);
  });

  /** Convert the A2UI surface to a json-render Spec for rendering.
   *  Prefers `state().surface` (the progressively-built wire surface)
   *  over the legacy `surface` input. surfaceToSpec handles
   *  children-id-list → spec.children translation + reserved-key
   *  filtering + path-ref → $bindState rewriting; the rendered tree
   *  then uses render-element's standard input-mapping
   *  (`childKeys: el.children`) so catalog components receive the
   *  inputs they actually declare.
   *
   *  An earlier slot-based progressive renderer mounted root components
   *  but never populated their childKeys input, leaving Columns/Rows/etc.
   *  with no children; the spec conversion replaced it. */
  readonly spec = computed(() => {
    const surf = this.state()?.surface ?? this.surface();
    return surf && surf.components.size > 0 ? surfaceToSpec(surf) : null;
  });

  /** Convert ViewRegistry to AngularRegistry for RenderSpecComponent. */
  readonly registry = computed(() => toRenderRegistry(this.catalog() as ViewRegistry));

  /** Merge built-in A2UI handlers with consumer-provided handlers. */
  readonly internalHandlers = computed(() => {
    const consumerHandlers = this.handlers();
    return {
      'a2ui:event': (params: Record<string, unknown>) => {
        // Prefer state.surface so action messages reference the surface
        // we actually rendered, even if a legacy `[surface]` input with
        // a mismatched id is also bound.
        const surf = this.state()?.surface ?? this.surface();
        if (!surf) return undefined;

        // Live model: user edits in the store overlay the agent-seeded model.
        const liveModel = this.mergedLiveModel(surf);

        // Validation gate: every check rule on the surface must pass before
        // an event action dispatches (spec CheckRule semantics).
        const failures = evaluateSurfaceChecks(surf, liveModel);
        if (failures.length > 0) {
          for (const f of failures) {
            this.liveStore.set(`/_a2uiChecks/${f.componentId}`, f.message);
          }
          const first = failures[0];
          this.validationError.emit({
            version: A2UI_WIRE_VERSION,
            error: {
              code: 'VALIDATION_FAILED',
              surfaceId: surf.surfaceId,
              ...(first.path ? { path: first.path } : {}),
              message: first.message,
            },
          });
          return undefined;
        }
        // Clear any stale messages from a previous failed submit.
        for (const [id, comp] of surf.components) {
          if (componentHasChecks(comp as unknown as Record<string, unknown>)) {
            this.liveStore.set(`/_a2uiChecks/${id}`, '');
          }
        }

        // Substitute live-context markers with current values.
        const rawContext = (params['context'] as Record<string, unknown>) ?? {};
        const context: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(rawContext)) {
          if (v != null && typeof v === 'object' && '$bindState' in (v as Record<string, unknown>)) {
            const path = String((v as Record<string, unknown>)['$bindState']);
            context[k] = getByPointer(liveModel, path);
          } else {
            context[k] = v;
          }
        }

        // sendDataModel metadata must carry the LIVE model (user edits
        // included), minus renderer-internal keys.
        const { _a2uiChecks, ...publicModel } = liveModel;
        void _a2uiChecks;
        const message = buildA2uiActionMessage(
          { ...params, context },
          { ...surf, dataModel: publicModel },
        );
        this.action.emit(message);
        return message;
      },
      'a2ui:localAction': (params: Record<string, unknown>) => {
        const call = params['call'] as string;
        const args = (params['args'] as Record<string, unknown>) ?? {};

        // Consumer handler takes priority
        if (consumerHandlers[call]) {
          return consumerHandlers[call](args);
        }

        // Built-in fallback
        if (call === 'openUrl' && typeof globalThis.window !== 'undefined') {
          globalThis.window.open(String(args['url'] ?? ''), '_blank', 'noopener');
        }
        return undefined;
      },
    };
  });

  onRenderEvent(event: RenderEvent): void {
    this.events.emit(event);
  }

  /** Agent-seeded data model overlaid with the store's current state
   * (user edits + check messages). Shallow per-key merge is sufficient:
   * store snapshots hold whole top-level values written via pointers. */
  private mergedLiveModel(surf: A2uiSurface): Record<string, unknown> {
    const snapshot = this.liveStore.getSnapshot() as Record<string, unknown>;
    return deepOverlay(surf.dataModel, snapshot);
  }
}

/** Recursively overlay `top` onto `base` (plain objects merge; anything
 * else in `top` wins). */
function deepOverlay(
  base: Record<string, unknown>,
  top: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(top)) {
    const prev = out[k];
    if (
      v != null && typeof v === 'object' && !Array.isArray(v)
      && prev != null && typeof prev === 'object' && !Array.isArray(prev)
    ) {
      out[k] = deepOverlay(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

const CHECK_FUNCTIONS = createA2uiFunctionRegistry();

interface CheckFailure {
  componentId: string;
  message: string;
  /** Data-model pointer of the checked value, when determinable. */
  path?: string;
}

/** Evaluate every check rule on the surface against the live model.
 * A rule passes when its condition resolves to exactly `true`. TextField
 * `validationRegexp` (with a bound value) contributes an implicit rule. */
function evaluateSurfaceChecks(
  surf: A2uiSurface,
  liveModel: Record<string, unknown>,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  for (const [id, comp] of surf.components) {
    const raw = comp as unknown as Record<string, unknown>;
    const boundPath = isPathRef(raw['value']) ? (raw['value'] as { path: string }).path : undefined;
    const rules: A2uiCheck[] = Array.isArray(raw['checks']) ? [...(raw['checks'] as A2uiCheck[])] : [];
    if (
      typeof raw['validationRegexp'] === 'string' && raw['validationRegexp'].length > 0 && boundPath
    ) {
      rules.push({
        condition: { call: 'regex', args: { value: { path: boundPath }, pattern: raw['validationRegexp'] } },
        message: 'Invalid format',
      });
    }
    for (const rule of rules) {
      if (!rule || typeof rule.message !== 'string') continue;
      const passed = resolveDynamic(rule.condition, liveModel, undefined, CHECK_FUNCTIONS) === true;
      if (!passed) {
        failures.push({ componentId: id, message: rule.message, ...(boundPath ? { path: boundPath } : {}) });
        break; // first failing rule per component
      }
    }
  }
  return failures;
}
