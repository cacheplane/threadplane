import {
  Component,
  ChangeDetectionStrategy,
  DOCUMENT,
  DestroyRef,
  computed,
  effect,
  signal,
  inject,
  untracked,
} from '@angular/core';
import { Router, RouterOutlet, NavigationEnd } from '@angular/router';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { filter, map, startWith } from 'rxjs/operators';
import {
  injectAgent,
  provideAgent,
  LangGraphThreadsAdapter,
  LANGGRAPH_THREADS_CONFIG,
  createLangGraphClient,
  refreshOnRunEnd,
} from '@threadplane/langgraph';
import { DEMO_AGENT_REF, type DemoState } from './agent-ref';
import { ItineraryStore, type ItineraryStop } from '../itinerary-store';
import { itineraryClientTools } from '../client-tools';
import { ThreadplaneTelemetryService } from '@threadplane/telemetry/browser';
import {
  ChatInterruptPanelComponent,
  ChatSidenavComponent,
  ChatSidenavScrimComponent,
  ChatHistorySearchPaletteComponent,
  ChatSelectComponent,
  injectThreadRouting,
  type ChatSidenavMode,
  type InterruptAction,
  type ThreadMatch,
  type ThreadActionAdapter,
  type Thread,
  type ProjectActionAdapter,
  type AgentRuntimeTelemetrySink,
} from '@threadplane/chat';
import { PalettePersistence } from './palette-persistence.service';
import { ProjectsService } from './projects.service';
import { MapCanvasComponent } from '../map-canvas.component';
import { ItineraryPanelComponent } from '../itinerary-panel.component';
import { DEMO_AGENT } from './shell-tokens';
import { createCanonicalDemoRuntimeTelemetrySink } from './runtime-telemetry';
import { environment } from '../../environments/environment';

export type DemoMode = 'embed' | 'popup' | 'sidebar';

const MODES: readonly DemoMode[] = ['embed', 'popup', 'sidebar'] as const;
const TELEMETRY_SURFACE = 'canonical_demo';

// ── Per-instance agent wiring (Option B) ────────────────────────────────────
// The agent's config is genuinely per-component: it watches the active-thread
// signal, mirrors auto-created ids back, and routes telemetry through the
// shell's model selection. `provideAgent({...})` takes a static config object,
// so the pieces it needs at construction time live at module scope here and the
// DemoShell instance reads/writes the same signals. The demo bootstraps a
// single DemoShell, so module scope is equivalent to instance scope.
const threadIdState = signal<string | null>(null);
// Populated by the DemoShell `agent` field initializer. The agent provider's
// static config delegates telemetry to this sink so it can read the live
// model selection + injected telemetry service (which the static config can't).
let telemetrySink: AgentRuntimeTelemetrySink | undefined;

/** Parse `/embed`, `/embed/<threadId>`, `/popup/<threadId>` etc. into
 *  `{mode, threadId}`. Source of truth for URL ↔ signal sync — see
 *  spec 2026-05-20-url-thread-routing-design.md. */
function parseUrl(url: string): { mode: DemoMode; threadId: string | null } {
  const segs = url.split('?')[0].split('#')[0].split('/').filter(Boolean);
  const mode = (MODES as readonly string[]).includes(segs[0]) ? (segs[0] as DemoMode) : 'embed';
  const threadId = segs[1] && segs[1].length > 0 ? segs[1] : null;
  return { mode, threadId };
}

// ── Itinerary ↔ checkpoint sync helpers (Task 9) ────────────────────────────
// Extracted as pure functions so the sync decisions are unit-testable without
// driving the agent's derived `value()`/`isLoading()` signals (which the fake
// transport harness can't emit). The effects below stay thin wrappers.

/**
 * Decide whether to push the working itinerary to the durable checkpoint.
 * Returns true when a thread exists and the itinerary changed since the last
 * sync. The `json === lastJson` check is the echo-loop guard: hydration stamps
 * `lastSyncedItinerary` with the incoming server JSON, so the re-fired push
 * effect sees "no change" and skips — making hydrate→push→hydrate converge.
 *
 * Run-state is intentionally NOT gated. The client-tool resume loop keeps the
 * agent loading for the whole plan, so a run-gated push never fires with the
 * final itinerary; instead the push attempts anyway and retries on the 409 a
 * mid-run `updateState` returns, until the run settles (see the push effect).
 */
export function shouldSyncCheckpoint(
  threadId: string | null,
  json: string,
  lastJson: string,
): boolean {
  if (!threadId) return false;
  return json !== lastJson;
}

/** Pull the itinerary array out of a graph-state `value()` snapshot, or null
 *  when the state has no (well-formed) itinerary to hydrate from. */
export function extractItinerary(value: unknown): ItineraryStop[] | null {
  if (value && typeof value === 'object') {
    const itin = (value as { itinerary?: unknown }).itinerary;
    if (Array.isArray(itin)) return itin as ItineraryStop[];
  }
  return null;
}

/** Cap on checkpoint-push retries — a backstop so a persistently-failing thread
 *  can't spin an unbounded background retry loop. */
export const MAX_PUSH_RETRIES = 20;

/** A mid-run `updateState` returns HTTP 409 (the client-tool resume loop is
 *  streaming); that is the ONLY error worth retrying. Any other failure
 *  (404/auth/500) is terminal for this best-effort sync. */
export function isConflict(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 409) return true;
  return /\b409\b|conflict/i.test(String((err as { message?: string })?.message ?? err));
}

@Component({
  selector: 'demo-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    ChatInterruptPanelComponent,
    ChatSidenavComponent,
    ChatSidenavScrimComponent,
    ChatHistorySearchPaletteComponent,
    ChatSelectComponent,
    MapCanvasComponent,
    ItineraryPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './demo-shell.component.html',
  styleUrl: './demo-shell.component.css',
  providers: [
    // Scoped agent (Option B): the config watches the active-thread signal,
    // mirrors auto-created ids back, and routes telemetry through the shell's
    // model selection — all per-instance. The telemetry sink delegates to the
    // shell-built sink (populated in the constructor) since the real sink needs
    // the injected telemetry service + live model() read.
    // Typed via DEMO_AGENT_REF so injectAgent(DEMO_AGENT_REF) returns a
    // LangGraphAgent<DemoState>. Static config: client retry options are
    // single-sourced in the adapter, so no lazy factory is needed here.
    provideAgent(DEMO_AGENT_REF, {
      apiUrl: environment.langGraphApiUrl,
      assistantId: environment.assistantId,
      threadId: threadIdState,
      onThreadId: (id: string) => {
        // The signal→URL effect picks this up and stamps the new id
        // into the URL — no persistence write needed any more, URL is
        // the source of truth.
        threadIdState.set(id);
      },
      // Phase 3B: tells SubagentTracker to treat `research` tool calls as
      // subagent dispatches and to materialize agent.subagents() from the
      // resulting tools:<id>-namespaced stream events.
      subagentToolNames: ['research'],
      // The canonical graph has side-effect LLM nodes such as generate_title;
      // only the generate node's token stream belongs in the chat transcript.
      transcriptNodeNames: ['generate'],
      telemetry: (event) => telemetrySink?.(event),
    }),
    { provide: DEMO_AGENT, useFactory: () => inject(DemoShell).agent },
  ],
})
export class DemoShell {
  private readonly router = inject(Router);
  private readonly persistence = inject(PalettePersistence);
  private readonly document = inject(DOCUMENT);
  protected readonly threadsSvc = inject(LangGraphThreadsAdapter);
  protected readonly projectsSvc = inject(ProjectsService);
  private readonly telemetry = inject(ThreadplaneTelemetryService);

  /** Shared working copy of the itinerary — an app-wide singleton (provided in
   *  app.config.ts) so this shell, the panel, and the map read/write ONE store. */
  protected readonly itinerary = inject(ItineraryStore);

  /** Frontend-owned itinerary client tools, forwarded to the chat mode
   *  components (`[clientTools]`) so the agent can read/mutate the panel.
   *  Built here (an injection context) since the registry injects the store. */
  readonly clientTools = itineraryClientTools();

  /** Out-of-band SDK client used to push the working itinerary to the durable
   *  checkpoint (`threads.updateState`) between runs. `LANGGRAPH_THREADS_CONFIG`
   *  is optional so knob/routing unit tests that don't provide it still run. */
  private readonly lgClient = createLangGraphClient(
    inject(LANGGRAPH_THREADS_CONFIG, { optional: true })?.apiUrl ?? environment.langGraphApiUrl,
  );

  /** JSON of the last itinerary we synced (either pushed OR hydrated). Breaks
   *  the hydrate→push→hydrate echo loop — see `shouldSyncCheckpoint`. */
  private lastSyncedItinerary = '';

  constructor() {
    // Reflect the chosen theme onto <html data-theme="..."> so the
    // global stylesheet's scoped --a2ui-* overrides activate. Runs on
    // signal change including initial mount (read from persistence).
    effect(() => {
      this.document.documentElement.setAttribute('data-theme', this.theme());
    });

    // App-wide color scheme: drives the demo page bg/text via
    // `data-color-scheme` and the chat-lib internals via
    // `data-threadplane-chat-theme`. The pre-bootstrap script in index.html
    // applies the initial value before stylesheets load; this effect
    // keeps both attrs synced after Angular takes over and also
    // auto-syncs the A2UI theme dropdown when it sits on a default
    // preset — material picks are left alone since the user opted in.
    effect(() => {
      const scheme = this.colorScheme();
      const html = this.document.documentElement;
      html.setAttribute('data-color-scheme', scheme);
      html.setAttribute('data-threadplane-chat-theme', scheme);
      const currentTheme = this.theme();
      if (currentTheme === 'default-dark' || currentTheme === 'default-light') {
        const next = scheme === 'light' ? 'default-light' : 'default-dark';
        if (currentTheme !== next) {
          this.theme.set(next);
          this.persistence.write('theme', next);
        }
      }
    });

    // Refresh threads list whenever the active thread changes (e.g. after
    // create or switch) so the panel stays up to date. The effect also
    // covers the initial load (fires synchronously on first reactive read).
    effect(() => {
      void this.threadIdSignal();
      void this.threadsSvc.refresh();
    });

    // Thread routing: binds threadIdState ↔ URL. Restores id from URL on
    // load, stamps signal changes into the URL, and validates thread ids
    // (redirecting to the bare mode path on 404). Replaces the three
    // hand-rolled effects that previously lived here.
    injectThreadRouting({
      threadId: threadIdState,
      threadIdFromUrl: (u) => parseUrl(u).threadId,
      toCommands: (id) => (id ? ['/', this.mode(), id] : ['/', this.mode()]),
      validate: (id) => this.threadsSvc.getThread(id).then(Boolean),
    });

    // URL → knob signals. Tracks urlState() so it re-fires on every
    // NavigationEnd (mode changes, query-param-only navigations both
    // emit). hydrateFromQuery is untracked-called because it reads
    // every knob signal and we don't want this effect to retrigger
    // itself when it writes them.
    effect(() => {
      void this.urlState();
      untracked(() => this.hydrateFromQuery());
    });

    // Refresh threads list when an agent run completes. The backend writes
    // metadata.title on the first user message via generate_title;
    // a refresh after run-end picks up the new title in the drawer without
    // needing a manual thread switch or reload.
    refreshOnRunEnd(this.agent, () => this.threadsSvc.refresh());

    // ── Itinerary ↔ checkpoint sync (Task 9) ────────────────────────────────
    // The checkpoint (per-thread graph state) is the durable record; the
    // ItineraryStore is the live working copy. We sync client-authoritatively.

    // (2) Hydrate the store from the checkpoint on reload / thread switch.
    // Reads the agent's graph-state value(); when it carries an itinerary
    // array, replaces the working copy. Stamps lastSyncedItinerary with the
    // incoming JSON so the push effect below sees "no change" and skips —
    // this is the other half of the echo-loop guard.
    effect(() => {
      const incoming = extractItinerary(this.agent.value());
      if (incoming === null) return;
      // Don't let a behind/empty server snapshot wipe a populated local working
      // copy: during a plan the client tools fill the store before the checkpoint
      // catches up via the push below. Adopt an empty server itinerary only when
      // the store is itself empty (a genuine thread switch / fresh load).
      if (incoming.length === 0 && untracked(() => this.itinerary.stops()).length > 0) return;
      const json = JSON.stringify(incoming);
      if (json === this.lastSyncedItinerary) return;
      this.lastSyncedItinerary = json;
      this.itinerary.hydrate(incoming);
    });

    // (3) Push the working copy to the durable checkpoint on every change.
    // NOT run-gated: the client-tool resume loop keeps the agent loading for
    // the whole plan, so a mid-run write returns 409 — retry ONLY that (bounded
    // by MAX_PUSH_RETRIES) until the run settles so the final itinerary always
    // lands. Debounced ~1200ms; onCleanup cancels a superseded attempt. Any
    // non-conflict error is terminal — this is a best-effort sync, not a queue.
    effect((onCleanup) => {
      const stops = this.itinerary.stops();
      const tid = threadIdState();
      const json = JSON.stringify(stops);
      if (!shouldSyncCheckpoint(tid, json, this.lastSyncedItinerary)) return;
      let cancelled = false;
      let retries = 0;
      let timer: ReturnType<typeof setTimeout>;
      const attempt = async (): Promise<void> => {
        if (cancelled) return;
        try {
          await this.lgClient.threads.updateState(tid as string, {
            values: { itinerary: stops },
          });
          this.lastSyncedItinerary = json;
        } catch (err) {
          if (!cancelled && isConflict(err) && retries++ < MAX_PUSH_RETRIES) {
            timer = setTimeout(() => void attempt(), 1500);
          }
        }
      };
      timer = setTimeout(() => void attempt(), 1200);
      onCleanup(() => {
        cancelled = true;
        clearTimeout(timer);
      });
    });

    if (typeof window !== 'undefined') {
      const onResize = () => this.viewportWidth.set(window.innerWidth);
      window.addEventListener('resize', onResize);
      inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
    }

    effect(() => {
      const q = this.searchQuery();
      if (this.searchDebounceTimer !== null) clearTimeout(this.searchDebounceTimer);
      this.searchDebounceTimer = setTimeout(() => {
        this.searchQueryDebounced.set(q);
      }, 150);
    });
  }

  /** Parsed URL — single source for both the active mode AND the URL's
   *  thread id. Refreshes on every NavigationEnd so back/forward and
   *  programmatic navigations both feed downstream effects. */
  private readonly urlState = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => parseUrl(e.urlAfterRedirects)),
      startWith(parseUrl(this.router.url)),
      takeUntilDestroyed(),
    ),
    { initialValue: parseUrl(this.router.url) },
  );

  protected readonly mode = computed<DemoMode>(() => this.urlState().mode);

  /** Whether the Google Maps key is configured — App mode needs the map,
   *  so the toggle is disabled without it. */
  readonly hasMapsKey = (environment.googleMapsApiKey as string).length > 0;

  /** App mode: a presentational layer valid only in popup/sidebar (embed's
   *  full-bleed chat would cover the map). Persisted across reloads and
   *  mirrored to the `appmode` query param so shared links restore it. */
  readonly appMode = signal<'on' | 'off'>(this.initialAppMode());

  /** Mode parsed from the REAL browser path. Available immediately at
   *  bootstrap (unlike router.url, which reads '/' before the initial
   *  navigation settles), so App mode restores against the right route. */
  private locationMode(): DemoMode {
    const path = this.document.defaultView?.location.pathname ?? '';
    const seg = path.split('/').filter(Boolean)[0];
    return (MODES as readonly string[]).includes(seg) ? (seg as DemoMode) : 'embed';
  }

  /** App mode persists across reloads, but it can only run in popup/sidebar —
   *  embed is full-chat with no background for the map. Reads the `appmode`
   *  query param from the real browser URL (available at bootstrap, unlike
   *  ActivatedRoute), falling back to persistence. Starts off when the value
   *  isn't 'on' OR the current route is embed (e.g. a hand-typed
   *  /embed?appmode=on). */
  private initialAppMode(): 'on' | 'off' {
    const search = this.document.defaultView?.location.search ?? '';
    const raw = (new URLSearchParams(search).get('appmode') ??
      this.persistence.read('appMode')) as 'on' | 'off' | null;
    if (raw !== 'on') return 'off';
    return this.locationMode() === 'embed' ? 'off' : 'on';
  }

  /**
   * The `?featured=` id, if the URL carries one.
   *
   * Read once at construction like `appmode`, not tracked reactively: this
   * selects which welcome suggestion leads on a cold open (the website's live
   * demo tabs link here per section), and re-reading it mid-session would let a
   * later navigation reshuffle the chips under the user.
   *
   * Passed through untouched. `suggestionsForAppMode` treats it as a key and
   * ignores anything it does not recognise, so no validation is needed here —
   * and none should be added, since sanitising it here would imply it is ever
   * rendered as content.
   */
  readonly featuredSuggestionId: string | undefined = this.initialFeaturedId();

  private initialFeaturedId(): string | undefined {
    const search = this.document.defaultView?.location.search ?? '';
    return new URLSearchParams(search).get('featured') ?? undefined;
  }

  /**
   * Source of truth for the model picker. The shell owns it; the
   * patched submit injects it into state on every send.
   */
  readonly model = signal<string>(this.persistence.read('model') ?? 'gpt-5-mini');

  /**
   * Reasoning effort for the next submit. Persisted across reloads.
   * `'default'` sends no effort, so the model's own default applies.
   */
  readonly effort = signal<string>(this.persistence.read('effort') ?? 'default');

  /**
   * GenUI dispatch mode for the next UI-render prompt. Controls which
   * sub-LLM tool the graph calls (generate_a2ui_schema vs
   * generate_json_render_spec). Persisted across reloads.
   */
  readonly genUiMode = signal<string>(this.persistence.read('genUiMode') ?? 'a2ui');

  /**
   * A2UI theme preset for the rendered surface. Toggles a `data-theme`
   * attribute on the document root which the global stylesheet keys
   * scoped `--a2ui-*` overrides off. Persisted across reloads.
   */
  readonly theme = signal<string>(this.persistence.read('theme') ?? 'default-dark');

  /**
   * App-wide color scheme. Single source of truth for the demo page bg,
   * the chat lib's internal `data-threadplane-chat-theme`, and (when the A2UI
   * theme is on a default preset) the base A2UI theme. Persisted.
   */
  readonly colorScheme = signal<'light' | 'dark'>(
    (this.persistence.read('colorScheme') as 'light' | 'dark' | null) ?? 'dark',
  );

  /** Whether the threads drawer is open. Always starts closed on a fresh
   *  load — drawer mode is a transient UI state, not a persisted preference. */
  protected readonly drawerOpen = signal<boolean>(false);

  /** Whether the Cmd+K search palette is open. */
  protected readonly paletteOpen = signal<boolean>(false);

  /** Current palette query. Two-way bound. */
  protected readonly searchQuery = signal<string>('');

  /** Debounced query — applied 150ms after the last keystroke. */
  private readonly searchQueryDebounced = signal<string>('');

  private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  /** Viewport width, refreshed on window resize. Drives drawer push/overlay decision. */
  private readonly viewportWidth = signal<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1440,
  );

  /**
   * User's chosen desktop sidenav mode. Persisted across reloads.
   * Below 768px the shell ignores this and forces drawer mode.
   */
  private readonly storedDesktopMode = signal<'expanded' | 'collapsed'>(
    (this.persistence.read('sidenavMode') as 'expanded' | 'collapsed' | null) ?? 'expanded',
  );

  /** Computed sidenav mode: App mode forces drawer (the cockpit reclaims the
   *  full width for the map + overlay), then viewport forces drawer below
   *  768px, else user preference. */
  protected readonly sidenavMode = computed<ChatSidenavMode>(() => {
    if (this.appMode() === 'on') return 'drawer';
    return this.viewportWidth() >= 768 ? this.storedDesktopMode() : 'drawer';
  });

  /** Active threads filtered by the selected project (or all when none selected). */
  protected readonly visibleThreads = computed<Thread[]>(() => {
    const sel = this.selectedProjectId();
    const all = this.threadsSvc.threads();
    return sel === null ? all : all.filter((t) => t.projectId === sel);
  });

  /** Client-side title filter over the loaded threads. */
  protected readonly searchResults = computed<ThreadMatch[]>(() => {
    const q = this.searchQueryDebounced().toLowerCase().trim();
    if (!q) return [];
    const active = this.threadsSvc.threads()
      .filter((t) => (t.title ?? '').toLowerCase().includes(q))
      .map((t) => ({ id: t.id, title: t.title ?? t.id }));
    const archived = this.threadsSvc.archivedThreads()
      .filter((t) => (t.title ?? '').toLowerCase().includes(q))
      .map((t) => ({ id: t.id, title: t.title ?? t.id, subtitle: 'Archived' }));
    return [...active, ...archived].slice(0, 50);
  });

  protected readonly modeOptions = [
    { value: 'embed', label: 'Embed' },
    { value: 'popup', label: 'Popup' },
    { value: 'sidebar', label: 'Sidebar' },
  ] as const;

  readonly modelOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'gpt-5', label: 'gpt-5' },
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
  ]);

  protected readonly effortOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'default', label: 'model default' },
    { value: 'minimal', label: 'minimal (fast)' },
    { value: 'low',     label: 'low' },
    { value: 'medium',  label: 'medium' },
    { value: 'high',    label: 'high (visible reasoning)' },
  ]);

  protected readonly genUiOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'a2ui',        label: 'A2UI' },
    { value: 'json-render', label: 'json-render' },
  ]);

  protected readonly themeOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'default-dark',   label: 'Default dark' },
    { value: 'default-light',  label: 'Default light' },
    { value: 'material-dark',  label: 'Material dark' },
    { value: 'material-light', label: 'Material light' },
  ]);

  /** Active thread id. URL is the sole source of truth; seeded from the
   *  URL on construction and kept in sync by `injectThreadRouting` (called
   *  in the constructor). The agent watches this signal via the module-level
   *  `threadIdState` reference in `provideAgent({...})`.
   *
   *  Mode switches that should preserve the active thread go through
   *  `onModeChange`, which navigates to `/<next-mode>/<id>` directly. */
  protected readonly threadIdSignal = threadIdState;

  /** Title of the currently-selected thread, or 'New chat' if none. The
   *  Python graph writes thread.metadata.title from the first user message
   *  via generate_title; threadsSvc surfaces it via threads(). */
  readonly currentThreadTitle = computed(() => {
    const id = this.threadIdSignal();
    if (!id) return 'New chat';
    const thread = this.threadsSvc.threads().find((t) => t.id === id);
    return thread?.title ?? 'New chat';
  });

  protected readonly selectedProjectId = signal<string | null>(
    this.persistence.read('selectedProjectId') ?? null,
  );

  protected readonly projectActions: ProjectActionAdapter = {
    create: async (name) => {
      const r = await this.projectsSvc.create(name);
      this.selectedProjectId.set(r.id);
      this.persistence.write('selectedProjectId', r.id);
      return r;
    },
    rename: (id, name) => this.projectsSvc.rename(id, name),
    delete: async (id) => {
      await this.projectsSvc.delete(id);
      if (this.selectedProjectId() === id) {
        this.selectedProjectId.set(null);
        this.persistence.write('selectedProjectId', null);
      }
    },
  };

  protected readonly threadActions: ThreadActionAdapter = {
    delete: async (id) => {
      await this.threadsSvc.delete(id);
      if (this.threadIdSignal() === id) this.threadIdSignal.set(null);
    },
    rename: (id, title) => this.threadsSvc.rename(id, title),
    archive: async (id) => {
      await this.threadsSvc.archive(id);
      if (this.threadIdSignal() === id) this.threadIdSignal.set(null);
    },
    unarchive: (id) => this.threadsSvc.unarchive(id),
    pin: (id) => this.threadsSvc.pin(id),
    unpin: (id) => this.threadsSvc.unpin(id),
    moveToProject: async (id, projectId) => {
      await this.threadsSvc.moveToProject(id, projectId);
    },
    reorderPinned: (id, beforeId) => this.threadsSvc.reorderPinned(id, beforeId),
  };

  /**
   * Shared agent instance. Patched submit injects state.model on every
   * submission so the graph picks up the latest model selection without
   * a reconnect.
   */
  readonly agent = (() => {
    // The agent itself is constructed by `provideAgent({...})` in the
    // @Component providers above (thread binding + subagentToolNames live
    // there). That static config can't read component state, so it delegates
    // telemetry to the module-level `telemetrySink` — which we populate here
    // from the injected telemetry service + live model() read.
    telemetrySink = createCanonicalDemoRuntimeTelemetrySink(
      this.telemetry,
      () => this.model(),
    );
    const a = injectAgent(DEMO_AGENT_REF);
    void this.telemetry.capture('tplane:browser_chat_init', { surface: TELEMETRY_SURFACE });
    const orig = a.submit.bind(a);
    (a as { submit: typeof a.submit }).submit = (async (
      input: Parameters<typeof a.submit>[0],
      opts?: Parameters<typeof a.submit>[1],
    ) => {
      return orig(
        {
          ...(input ?? {}),
          state: {
            ...((input as { state?: Record<string, unknown> })?.state ?? {}),
            model: this.model(),
            reasoning_effort: this.effort() === 'default' ? null : this.effort(),
            gen_ui_mode: this.genUiMode(),
            itinerary: this.itinerary.stops(),
          },
        },
        opts,
      );
    }) as typeof a.submit;
    return a;
  })();

  /** Typed read: proves DemoState flows through DI. Not used at runtime. */
  protected readonly _demoState: DemoState = this.agent.value();

  protected onModeChange(next: DemoMode | string): void {
    // Embed can't coexist with App mode (its full-bleed chat covers the
    // map), so selecting Embed while App mode is on turns App mode off.
    // Popup and Sidebar layer over the map, so they leave App mode alone.
    if (next === 'embed' && this.appMode() === 'on') {
      this.appMode.set('off');
      this.persistence.write('appMode', 'off');
    }
    // Preserve the active thread across mode switches: /embed/abc →
    // /popup/abc keeps the conversation visible in the new chrome.
    // Preserve query params so knob state survives the mode hop.
    const id = this.threadIdSignal();
    void this.router.navigate(
      id ? ['/', next, id] : ['/', next],
      { queryParamsHandling: 'preserve' },
    );
  }

  /**
   * Toggle App mode. Enabling it needs a background area for the map —
   * embed has none, so it coerces to the sidebar cockpit; popup/sidebar
   * keep their current presentation. Unlike ag-ui-shell (which has a
   * knob→URL effect that resolves routing), demo-shell is URL-as-truth,
   * so this handler both navigates AND writes `appmode` to the query
   * itself (merging so knob params survive).
   */
  onAppModeChange(v: 'on' | 'off'): void {
    this.persistence.write('appMode', v);
    if (v === 'on' && this.mode() === 'embed') {
      // Navigate to the sidebar cockpit first (preserving query so the
      // active thread + knobs survive), then flip the signal + stamp
      // appmode=on into the URL.
      const id = this.threadIdSignal();
      void this.router
        .navigate(id ? ['/', 'sidebar', id] : ['/', 'sidebar'], {
          queryParamsHandling: 'preserve',
        })
        .then(() => {
          this.appMode.set('on');
          void this.router.navigate([], {
            queryParams: { appmode: 'on' },
            queryParamsHandling: 'merge',
            replaceUrl: true,
          });
        });
      return;
    }
    // popup/sidebar (or turning off): keep the current route, just update
    // the appmode query param. 'off' → null drops it from the URL.
    this.appMode.set(v);
    void this.router.navigate([], {
      queryParams: { appmode: v === 'off' ? null : 'on' },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** Build the full knob → URL-value mapping. Default values become
   *  null so Angular's router drops them from the resulting URL when
   *  used with queryParamsHandling: 'merge'. */
  private buildQueryParams(): Record<string, string | null> {
    return {
      model:   this.model()             === 'gpt-5-mini'    ? null : this.model(),
      effort:  this.effort()            === 'default'       ? null : this.effort(),
      genui:   this.genUiMode()         === 'a2ui'          ? null : this.genUiMode(),
      theme:   this.theme()             === 'default-dark'  ? null : this.theme(),
      color:   this.colorScheme()       === 'dark'          ? null : this.colorScheme(),
      project: this.selectedProjectId() ?? null,
    };
  }

  /** Signal → URL bridge for agent knobs. Called by each knob handler
   *  after it sets its signal + persistence. Uses queryParamsHandling:
   *  'merge' + replaceUrl so dropdown clicks don't pollute history. */
  private writeKnobsToUrl(): void {
    void this.router.navigate([], {
      queryParams: this.buildQueryParams(),
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  /** URL → signal bridge for agent knobs. Fires on every NavigationEnd
   *  via the constructor effect. Sets each knob signal to its URL value
   *  iff present and different. NEVER writes to persistence — that's
   *  the "ephemeral hydration" contract: shared links override signals
   *  but don't clobber a recipient's localStorage. Explicit user
   *  actions (onModelChange etc.) still persist via persistence.write.
   *
   *  Explicit per-knob blocks (not a typed loop) because `colorScheme`
   *  is constrained to `'light' | 'dark'` — a generic loop would need
   *  ugly casts or runtime any. */
  private hydrateFromQuery(): void {
    const params = new URL(this.router.url, 'http://x').searchParams;

    const model = params.get('model');
    if (model !== null && model !== this.model()) this.model.set(model);

    const effort = params.get('effort');
    if (effort !== null && effort !== this.effort()) this.effort.set(effort);

    const genui = params.get('genui');
    if (genui !== null && genui !== this.genUiMode()) this.genUiMode.set(genui);

    const theme = params.get('theme');
    if (theme !== null && theme !== this.theme()) this.theme.set(theme);

    const color = params.get('color');
    if ((color === 'light' || color === 'dark') && color !== this.colorScheme()) {
      this.colorScheme.set(color);
    }

    const project = params.get('project');
    if (project !== null && project !== this.selectedProjectId()) {
      this.selectedProjectId.set(project);
    }
  }

  onModelChange(next: string): void {
    this.model.set(next);
    this.persistence.write('model', next);
    this.writeKnobsToUrl();
  }

  protected onEffortChange(next: string): void {
    this.effort.set(next);
    this.persistence.write('effort', next);
    this.writeKnobsToUrl();
  }

  protected onGenUiModeChange(next: string): void {
    this.genUiMode.set(next);
    this.persistence.write('genUiMode', next);
    this.writeKnobsToUrl();
  }

  protected onThemeChange(next: string): void {
    this.theme.set(next);
    this.persistence.write('theme', next);
    this.writeKnobsToUrl();
  }

  protected onColorSchemeChange(next: 'light' | 'dark' | string): void {
    if (next !== 'light' && next !== 'dark') return;
    this.colorScheme.set(next);
    this.persistence.write('colorScheme', next);
    this.writeKnobsToUrl();
  }

  protected onSidenavOpenChange(next: boolean): void {
    this.drawerOpen.set(next);
  }

  protected toggleSidenav(): void {
    this.onSidenavOpenChange(!this.drawerOpen());
  }

  protected onSidenavModeChange(next: ChatSidenavMode): void {
    // Drawer is viewport-driven; ignore user attempts to set it directly.
    if (next === 'drawer') return;
    this.storedDesktopMode.set(next);
    this.persistence.write('sidenavMode', next);
  }

  /** Switch to an existing thread selected from the threads panel. */
  protected onThreadSelected(threadId: string): void {
    this.threadIdSignal.set(threadId);
  }

  protected onProjectSelected(projectId: string): void {
    this.selectedProjectId.set(projectId);
    this.persistence.write('selectedProjectId', projectId);
    this.writeKnobsToUrl();
  }

  protected onNewProjectClicked(): void {
    // Framework's chat-project-list owns the inline-create flow; this is an
    // informational event for the consumer.
  }

  protected onSearchSelect(threadId: string): void {
    this.onThreadSelected(threadId);
    this.paletteOpen.set(false);
    this.searchQuery.set('');
  }

  /** Create a new thread via the backend and switch to it. */
  protected async onNewThread(): Promise<void> {
    const sel = this.selectedProjectId();
    const id = await this.threadsSvc.create(sel ? { projectId: sel } : {});
    if (id) this.threadIdSignal.set(id);
  }

  /**
   * Translates the four-action vocabulary from chat-interrupt-panel
   * into Command(resume=value) submissions. Phase 3A demo affordance:
   * window.prompt() for `edit` and `respond`. A production app would
   * inline a textarea editor.
   */
  protected async onInterruptAction(action: InterruptAction): Promise<void> {
    const interrupt = this.agent.interrupt?.();
    if (!interrupt) return;

    let resume: unknown;
    switch (action) {
      case 'accept':
        resume = 'approved';
        break;
      case 'edit': {
        const reason = (interrupt.value as { reason?: string })?.reason ?? '';
        const edited = window.prompt(
          `Edit your response (current proposal: "${reason}"):`,
          'approved',
        );
        if (edited == null) return;
        resume = edited;
        break;
      }
      case 'respond': {
        const text = window.prompt('Respond to the agent:', '');
        if (text == null) return;
        resume = text;
        break;
      }
      case 'ignore':
        resume = 'denied';
        break;
    }

    await this.agent.submit(null, { command: { resume } } as never);
  }
}
