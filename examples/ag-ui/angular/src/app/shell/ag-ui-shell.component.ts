import {
  Component,
  ChangeDetectionStrategy,
  DOCUMENT,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { injectAgent } from '@threadplane/angular';
import {
  ChatInterruptPanelComponent,
  type InterruptAction,
} from '@threadplane/angular/chat';
import {
  ChatSelectComponent,
} from '@threadplane/angular/chat/select';
import { PalettePersistence } from './palette-persistence.service';
import { ItineraryPanelComponent } from '../itinerary-panel.component';
import { MapCanvasComponent } from '../map-canvas.component';
import { itineraryClientTools, ITINERARY_AGENT, ItineraryRunState } from '../client-tools';
import { environment } from '../../environments/environment';

export type DemoMode = 'embed' | 'popup' | 'sidebar';
const MODES: readonly DemoMode[] = ['embed', 'popup', 'sidebar'] as const;

/**
 * Default knob values — omitted from the URL when active. The `'default'`
 * effort sends no `reasoning_effort`, so the model's own default applies.
 */
const DEFAULTS = {
  model: 'gpt-5-mini',
  effort: 'default',
  genui: 'a2ui',
  theme: 'default-dark',
  scheme: 'dark',
} as const;

@Component({
  selector: 'ag-ui-shell',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, ChatSelectComponent, ChatInterruptPanelComponent, ItineraryPanelComponent, MapCanvasComponent],
  templateUrl: './ag-ui-shell.component.html',
  styleUrl: './ag-ui-shell.component.css',
  providers: [PalettePersistence],
})
export class AgUiShell {
  private readonly router = inject(Router);
  private readonly document = inject(DOCUMENT);
  protected readonly persistence = inject(PalettePersistence);

  // ── Knob signals: URL > localStorage > default ───────────────────────────
  private urlKnob(name: string): string | null {
    // AgUiShell is not a routed component so ActivatedRoute.snapshot may not
    // carry query params at initialization time. Read from window.location.search
    // (the real browser URL) which is available immediately at bootstrap.
    const win = this.document.defaultView;
    const search = win?.location.search ?? '';
    const v = new URLSearchParams(search).get(name);
    return v && v.length > 0 ? v : null;
  }

  readonly model = signal<string>(this.urlKnob('model') ?? this.persistence.read('model') ?? DEFAULTS.model);
  readonly effort = signal<string>(this.urlKnob('effort') ?? this.persistence.read('effort') ?? DEFAULTS.effort);
  readonly genUiMode = signal<string>(this.urlKnob('genui') ?? this.persistence.read('genUiMode') ?? DEFAULTS.genui);
  readonly theme = signal<string>(this.urlKnob('theme') ?? this.persistence.read('theme') ?? DEFAULTS.theme);
  readonly colorScheme = signal<'light' | 'dark'>(
    ((this.urlKnob('scheme') ?? this.persistence.read('colorScheme')) as 'light' | 'dark' | null) ?? DEFAULTS.scheme,
  );
  readonly appMode = signal<'on' | 'off'>(this.initialAppMode());
  readonly hasMapsKey = (environment.googleMapsApiKey as string).length > 0;

  // ── Mode from the active route ───────────────────────────────────────────
  // Seed from the real browser path (router.url isn't settled at bootstrap, so
  // a fresh reload of e.g. /popup would otherwise read as the default /embed).
  readonly mode = signal<DemoMode>(
    this.parseMode(this.document.defaultView?.location?.pathname ?? this.router.url),
  );
  protected readonly modeOptions: readonly { value: DemoMode; label: string }[] = [
    { value: 'embed', label: 'Embed' },
    { value: 'popup', label: 'Popup' },
    { value: 'sidebar', label: 'Sidebar' },
  ];

  private parseMode(url: string): DemoMode {
    const seg = url.split('?')[0].split('/').filter(Boolean)[0];
    return (MODES as readonly string[]).includes(seg) ? (seg as DemoMode) : 'embed';
  }

  /** Mode parsed from the real browser path. Available immediately at bootstrap
   *  (unlike router.url, which reads '/' before the initial navigation settles),
   *  so the param-sync effect restores the right route on reload. */
  private locationMode(): DemoMode {
    const path = this.document.defaultView?.location.pathname ?? '';
    const seg = path.split('/').filter(Boolean)[0];
    return (MODES as readonly string[]).includes(seg) ? (seg as DemoMode) : 'embed';
  }

  /** App mode persists across reloads, but it can only run in popup/sidebar —
   *  embed is full-chat with no background for the map. Start off if the route
   *  is embed (e.g. a hand-typed /embed?appmode=on). */
  private initialAppMode(): 'on' | 'off' {
    const raw = (this.urlKnob('appmode') ?? this.persistence.read('appMode')) as 'on' | 'off' | null;
    if (raw !== 'on') return 'off';
    return this.locationMode() === 'embed' ? 'off' : 'on';
  }

  // ── Select options (canonical lists) ─────────────────────────────────────
  readonly modelOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'gpt-5-mini', label: 'gpt-5-mini' },
    { value: 'gpt-5-nano', label: 'gpt-5-nano' },
  ]);
  protected readonly effortOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'default', label: 'model default' },
    { value: 'minimal', label: 'minimal (fast)' },
    { value: 'low', label: 'low' },
    { value: 'medium', label: 'medium' },
    { value: 'high', label: 'high (visible reasoning)' },
  ]);
  protected readonly genUiOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'a2ui', label: 'A2UI' },
    { value: 'json-render', label: 'json-render' },
  ]);
  protected readonly themeOptions = signal<readonly { value: string; label: string }[]>([
    { value: 'default-dark', label: 'Default dark' },
    { value: 'default-light', label: 'Default light' },
    { value: 'material-dark', label: 'Material dark' },
    { value: 'material-light', label: 'Material light' },
  ]);

  // Frontend-declared client tools (itinerary get/add/move/clear + day_card).
  // Built in an injection context (field initializer) so itineraryClientTools()
  // can inject the shared ItineraryStore. Modes bind this to <chat [clientTools]>.
  readonly clientTools = itineraryClientTools();

  // ── Shared agent: every run carries the knobs in its state ──────────────
  // The injected Agent cannot be patched, so the merge lives in the session:
  // app.config wraps each session's submit/resume with `withRunState`, which
  // asks ItineraryRunState for the knobs as they are when a request is sent.
  readonly agent = injectAgent(ITINERARY_AGENT);

  constructor() {
    inject(ItineraryRunState).read = () => ({
      model: this.model(),
      reasoning_effort: this.effort() === DEFAULTS.effort ? null : this.effort(),
      gen_ui_mode: this.genUiMode(),
    });

    // Routed mode components read the shared agent via
    // `inject(AgUiShell).agent` — no token needed.
    // Keep mode() in sync with navigation.
    this.router.events.subscribe(() => {
      const m = this.parseMode(this.router.url);
      if (m !== this.mode()) this.mode.set(m);
    });

    // Reflect theme + scheme onto <html> exactly like the canonical shell.
    effect(() => {
      const html = this.document.documentElement;
      html.setAttribute('data-theme', this.theme());
      const scheme = this.colorScheme();
      html.setAttribute('data-threadplane-chat-theme', scheme);
      html.setAttribute('data-color-scheme', scheme);
      const t = this.theme();
      if (t === 'default-dark' || t === 'default-light') {
        const next = scheme === 'light' ? 'default-light' : 'default-dark';
        if (next !== t) this.theme.set(next);
      }
    });

    // Persist + sync knobs to the URL (defaults omitted).
    effect(() => {
      const q: Record<string, string | null> = {
        model: this.model() === DEFAULTS.model ? null : this.model(),
        effort: this.effort() === DEFAULTS.effort ? null : this.effort(),
        genui: this.genUiMode() === DEFAULTS.genui ? null : this.genUiMode(),
        theme: this.theme() === DEFAULTS.theme ? null : this.theme(),
        scheme: this.colorScheme() === DEFAULTS.scheme ? null : this.colorScheme(),
        appmode: this.appMode() === 'off' ? null : this.appMode(),
      };
      // App mode is compatible with the sidebar AND popup routes (chat as a
      // right rail / floating bubble over the map) but mutually exclusive with
      // embed (full-bleed chat would cover the map). Always navigate to the
      // EXPLICIT current mode — a route-relative [] resolves against the
      // not-yet-settled initial navigation on a fresh load and bounces to
      // /embed. Read mode untracked so this effect fires on knob changes, not
      // on navigation (which onModeChange drives). Coerce a stray embed while
      // App mode is on (e.g. a direct /embed?appmode=on) to the sidebar cockpit.
      const m = untracked(() => this.mode());
      const target = this.appMode() === 'on' && m === 'embed' ? 'sidebar' : m;
      void this.router.navigate(['/', target], { queryParams: q, queryParamsHandling: 'merge', replaceUrl: true });
    });
  }

  protected onModeChange(next: DemoMode | string): void {
    if (!(MODES as readonly string[]).includes(next as string)) return;
    // Embed can't coexist with App mode (its full-bleed chat covers the map),
    // so selecting Embed while App mode is on turns App mode off. Popup and
    // Sidebar layer over the map, so they leave App mode untouched.
    if (next === 'embed' && this.appMode() === 'on') {
      this.appMode.set('off');
      this.persistence.write('appMode', 'off');
    }
    void this.router.navigate(['/', next], { queryParamsHandling: 'preserve' });
  }
  onAppModeChange(v: 'on' | 'off'): void {
    // Enabling App mode needs a background area for the map. Embed has none, so
    // it auto-switches to the sidebar cockpit; popup/sidebar keep their current
    // presentation. Navigate first, then flip the signal so the param-sync
    // effect resolves against the new route.
    if (v === 'on' && this.mode() === 'embed') {
      void this.router.navigate(['/', 'sidebar'], { queryParamsHandling: 'preserve' }).then(() => {
        this.appMode.set('on');
        this.persistence.write('appMode', 'on');
      });
      return;
    }
    this.appMode.set(v);
    this.persistence.write('appMode', v);
    // Routing is handled by the persist effect: turning App mode on navigates to
    // the current map-compatible mode (coercing embed → sidebar); turning it off
    // keeps the current route.
  }
  onModelChange(v: string): void { this.model.set(v); this.persistence.write('model', v); }
  protected onEffortChange(v: string): void { this.effort.set(v); this.persistence.write('effort', v); }
  protected onGenUiModeChange(v: string): void { this.genUiMode.set(v); this.persistence.write('genUiMode', v); }
  protected onThemeChange(v: string): void { this.theme.set(v); this.persistence.write('theme', v); }
  protected onColorSchemeChange(v: 'light' | 'dark' | string): void {
    if (v !== 'light' && v !== 'dark') return;
    this.colorScheme.set(v);
    this.persistence.write('colorScheme', v);
  }

  /** Same four-action vocabulary as the canonical shell; answers the pending
   *  interrupt with agent.resume (forwardedProps.command.resume on the wire). */
  protected async onInterruptAction(action: InterruptAction): Promise<void> {
    const interrupt = this.agent.interrupts()?.[0];
    if (!interrupt) return;
    let resume: string;
    switch (action) {
      case 'accept': resume = 'approved'; break;
      case 'edit': {
        const reason = (interrupt.value as { reason?: string })?.reason ?? '';
        const edited = window.prompt(`Edit your response (current proposal: "${reason}"):`, 'approved');
        if (edited == null) return;
        resume = edited; break;
      }
      case 'respond': {
        const text = window.prompt('Respond to the agent:', '');
        if (text == null) return;
        resume = text; break;
      }
      case 'ignore': resume = 'denied'; break;
    }
    await this.agent.resume([{ interruptId: interrupt.id, status: 'resolved', value: resume }]);
  }
}
