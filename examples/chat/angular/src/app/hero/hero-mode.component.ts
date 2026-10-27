import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  EnvironmentInjector,
  InjectionToken,
  afterNextRender,
  computed,
  createEnvironmentInjector,
  inject,
  signal,
  type Provider,
  type WritableSignal,
} from '@angular/core';
import {
  ChatComponent,
  ChatInterruptPanelComponent,
  type AgentRef,
  type InterruptAction,
} from '@threadplane/chat';
import {
  FetchStreamTransport,
  injectAgent,
  provideAgent,
  type AgentConfig,
  type LangGraphAgent,
} from '@threadplane/langgraph';
import { environment } from '../../environments/environment';
import { demoViews } from '../demo-views';
import { WelcomeSuggestionsComponent } from '../modes/welcome-suggestions.component';
import { HERO_LIVE_REF, HERO_REPLAY_REF } from './hero-agent-refs';
import { browserHeroBridge, type HeroBridge } from './hero-bridge';
import { HeroCursorComponent } from './hero-cursor.component';
import {
  composerOf,
  cursorPointFor,
  pressButton,
  sendButtonOf,
  acceptButtonOf,
  typeIntoTextarea,
} from './hero-dom-host';
import { HeroRecordingTransport } from './hero-recording.transport';
import { HeroReplayTransport } from './hero-replay.transport';
import {
  CURSOR_MOVE_MS,
  HeroScriptRunner,
  TYPE_DELAY_MS,
  type CursorTarget,
  type HeroScriptHost,
} from './hero-script';

export type HeroModeKind = 'replay' | 'live';

/**
 * The embed handshake is a race the frame cannot win on its own. The parent
 * posts `{ visible: true }` on the iframe's `load` event, but this component
 * only registers its `message` listener inside `boot()` — after the lazy route
 * chunk has loaded and Angular has rendered — so that single post can land
 * before anyone is listening and be lost forever. Rather than trusting one
 * message, a frame that has not yet heard from its embedder keeps announcing
 * `ready`; the parent answers every announcement with the current visibility.
 */
export const HERO_READY_ANNOUNCE_MS = 500;
export const HERO_READY_ANNOUNCE_MAX_MS = 10_000;

function isEmbedded(): boolean {
  return typeof window !== 'undefined' && window.parent !== window;
}

/**
 * The live agent's thread id, held per component instance (NOT at module
 * scope): a second visit to /hero must start a genuinely new thread, which is
 * what the "new thread" pill promises.
 */
const HERO_LIVE_THREAD_ID = new InjectionToken<WritableSignal<string | null>>('HERO_LIVE_THREAD_ID');

function isRecordMode(): boolean {
  if (environment.production || typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('record') === '1';
}

/**
 * `?replay=only` is the opt-in for third-party embeds: the frame plays the
 * recorded run and never offers — or falls back to — the live agent. Record
 * mode wins, since it exists to drive the live agent.
 */
export function isReplayOnly(): boolean {
  if (isRecordMode() || typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('replay') === 'only';
}

/**
 * `provideAgent()` registers the shared AGENT token and aliases the ref to it,
 * so two calls in ONE providers array collapse into a single agent (last one
 * wins). The hero needs two live-at-once agents, so each gets its own child
 * environment injector holding exactly one `provideAgent()`.
 */
function scopedAgent(ref: AgentRef<Record<string, unknown>>, config: AgentConfig): LangGraphAgent {
  const injector = createEnvironmentInjector(provideAgent(ref, config), inject(EnvironmentInjector));
  inject(DestroyRef).onDestroy(() => injector.destroy());
  return injector.get(ref.token) as LangGraphAgent;
}

/**
 * Same filter the demo shell applies: the canonical graph has side-effect LLM
 * nodes (generate_title), and only the generate node's tokens belong in the
 * transcript. Without it the title's tokens land on the just-completed answer
 * and trip the streaming-markdown contract, which stops the next turn from
 * rendering. The replay agent needs it too — the recording carries the same
 * events the live run did.
 */
const TRANSCRIPT_NODE_NAMES = ['generate'];

function heroProviders(replay?: HeroReplayTransport): Provider[] {
  return [
    // useFactory, not useValue: this array is built once at decorator time, so
    // a `new HeroReplayTransport()` here would be a module singleton and would
    // carry its runIndex across route re-entries.
    { provide: HeroReplayTransport, useFactory: () => replay ?? new HeroReplayTransport() },
    { provide: HERO_LIVE_THREAD_ID, useFactory: () => signal<string | null>(null) },
    {
      provide: HERO_REPLAY_REF.token,
      useFactory: () =>
        scopedAgent(HERO_REPLAY_REF, {
          assistantId: 'hero-replay',
          transport: inject(HeroReplayTransport),
          transcriptNodeNames: TRANSCRIPT_NODE_NAMES,
        }),
    },
    {
      provide: HERO_LIVE_REF.token,
      useFactory: () => {
        const liveThreadId = inject(HERO_LIVE_THREAD_ID);
        return scopedAgent(HERO_LIVE_REF, {
          apiUrl: environment.langGraphApiUrl,
          assistantId: environment.assistantId,
          threadId: liveThreadId,
          onThreadId: (id: string) => liveThreadId.set(id),
          transcriptNodeNames: TRANSCRIPT_NODE_NAMES,
          transport: isRecordMode()
            ? new HeroRecordingTransport(
                new FetchStreamTransport(environment.langGraphApiUrl, (id) => liveThreadId.set(id)),
              )
            : undefined,
        });
      },
    },
  ];
}

@Component({
  selector: 'hero-mode',
  standalone: true,
  imports: [ChatComponent, ChatInterruptPanelComponent, WelcomeSuggestionsComponent, HeroCursorComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: heroProviders(),
  template: `
    <div class="hero" [attr.data-mode]="mode()" [attr.data-replay-only]="replayOnly || null">
      <div class="hero__bar">
        <span class="hero__url">demo.threadplane.ai</span>
        <span class="hero__pill" data-hero-pill [attr.data-live]="mode() === 'live'">
          <span class="hero__dot" aria-hidden="true"></span>
          @if (mode() === 'live') {
            Live · LangGraph · new thread
          } @else {
            Replaying a recorded LangGraph run
          }
        </span>
      </div>
      <div class="hero__surface" data-hero-surface (pointerdown)="takeControl()" (focusin)="onFocusIn($event)">
        @if (mode() === 'live') {
          <p class="hero__banner" data-hero-banner role="status">
            You are live on a new LangGraph thread. The walkthrough was a recording.
            <button type="button" class="hero__link" data-hero-replay (click)="replay($event)">
              Replay walkthrough
            </button>
          </p>
        }
        @if (hasInterrupt()) {
          <div class="hero__interrupt" role="region" aria-label="Approval required">
            <chat-interrupt-panel [agent]="activeAgent()" (action)="onInterruptAction($event)" />
          </div>
        }
        <chat [agent]="activeAgent()" [views]="catalog">
          @if (mode() === 'live') {
            <welcome-suggestions chatWelcomeSuggestions (selected)="sendLive($event)" />
          }
        </chat>
        <hero-cursor [x]="cursorX()" [y]="cursorY()" [visible]="cursorVisible()" [pressed]="cursorPressed()" />
      </div>
      @if (mode() === 'replay' && !replayOnly) {
        <button type="button" class="hero__take" data-hero-take-control (click)="takeControl()">
          Take control ↗
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .hero { position: relative; display: flex; flex-direction: column; height: 100%; }
      .hero__bar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 6px 12px; font: 12px/1.3 system-ui, sans-serif; border-bottom: 1px solid rgba(128,128,128,.25); }
      .hero__url { opacity: .6; }
      .hero__pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; border: 1px solid #b5731a; color: #b5731a; }
      .hero__pill[data-live='true'] { border-color: #2f6f4f; color: #2f6f4f; }
      .hero__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
      .hero__surface { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; }
      .hero__surface > chat { flex: 1; min-height: 0; }
      .hero[data-replay-only] .hero__surface { pointer-events: none; }
      .hero__interrupt { padding: 8px 12px 0; }
      .hero__banner { margin: 0; padding: 8px 12px; font: 13px/1.4 system-ui, sans-serif; background: rgba(47,111,79,.08); border-bottom: 1px solid rgba(47,111,79,.3); }
      .hero__link { margin-left: 8px; background: none; border: 0; padding: 0; color: inherit; text-decoration: underline; cursor: pointer; font: inherit; }
      /* In normal flow, NOT absolutely positioned: floating it over the surface
         put it on top of the streaming answer at 768px and on top of the empty
         welcome copy at 390px, and it half-covered the composer's send button. */
      .hero__take { flex: none; align-self: center; margin: 8px 12px 12px; padding: 8px 14px; border-radius: 999px; border: 0; background: #111; color: #fff; font: 600 13px/1 system-ui, sans-serif; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.18); }
      .hero__take:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
    `,
  ],
})
export class HeroMode implements HeroScriptHost {
  /**
   * TEST SEAM. The spec substitutes a preloaded replay transport through this
   * so it never reaches the network for `/hero-replay.json`.
   */
  static providersForTest(replay?: HeroReplayTransport): Provider[] {
    return heroProviders(replay);
  }

  /**
   * TEST SEAM. Specs that only assert on markup would otherwise start a real
   * walkthrough with real timers on `afterNextRender`.
   */
  static autoBoot = true;
  static disableAutoBootForTests(): void {
    HeroMode.autoBoot = false;
  }
  static enableAutoBoot(): void {
    HeroMode.autoBoot = true;
  }

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);
  private readonly replayTransport = inject(HeroReplayTransport);
  private readonly liveThreadId = inject(HERO_LIVE_THREAD_ID);
  private readonly replayAgent = injectAgent(HERO_REPLAY_REF) as LangGraphAgent;
  private readonly liveAgent = injectAgent(HERO_LIVE_REF) as LangGraphAgent;

  /** Read once: the query string cannot change under a mounted frame. */
  readonly replayOnly = isReplayOnly();
  readonly mode = signal<HeroModeKind>(isRecordMode() ? 'live' : 'replay');
  readonly activeAgent = computed<LangGraphAgent>(() =>
    this.mode() === 'live' ? this.liveAgent : this.replayAgent,
  );
  protected readonly catalog = demoViews();
  readonly cursorX = signal(0);
  readonly cursorY = signal(0);
  readonly cursorVisible = signal(false);
  readonly cursorPressed = signal(false);

  /** TEST SEAM. Replaced by the spec; browser bridge by default. */
  bridge: HeroBridge =
    typeof window === 'undefined'
      ? { postState: () => undefined, onVisibility: () => () => undefined }
      : browserHeroBridge();
  /** TEST SEAM. Overridable the same way `bridge` is, instead of mocking matchMedia globally. */
  reducedMotion =
    typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

  private runner: HeroScriptRunner | null = null;

  /**
   * Two INDEPENDENT visibility sources, ANDed. Collapsing them into one field
   * makes `document.hidden` latch: once a tab-away pauses the hero it can
   * never resume, because the resume reads the field it just cleared.
   */
  private readonly embedVisible = signal(false);
  private readonly docVisible = signal(typeof document === 'undefined' ? true : !document.hidden);
  readonly visible = computed(() => this.embedVisible() && this.docVisible());

  /**
   * True while a host action (typing, sending, accepting) is driving the DOM.
   * `ChatInputComponent.onSubmit()` refocuses the textarea on a
   * `requestAnimationFrame` after a click, which would otherwise fire our
   * `focusin` takeover and make the walkthrough take control of itself on its
   * very first send.
   */
  private scriptDriving = false;

  /** Set by the FIRST visibility message; ends the `ready` re-announcements. */
  private embedderAnswered = false;
  private readyAnnounce: ReturnType<typeof setInterval> | null = null;

  constructor() {
    afterNextRender(() => {
      if (HeroMode.autoBoot) void this.boot();
    });
    this.destroyRef.onDestroy(() => this.runner?.stop());
    this.destroyRef.onDestroy(() => this.stopAnnouncingReady());
  }

  /** Public so a spec can boot explicitly with `autoBoot` disabled. */
  async boot(): Promise<void> {
    try {
      const off = this.bridge.onVisibility((v) => this.setEmbedVisible(v));
      this.destroyRef.onDestroy(off);
      const onDocVis = () => {
        this.docVisible.set(!document.hidden);
        this.applyVisibility();
      };
      document.addEventListener('visibilitychange', onDocVis);
      this.destroyRef.onDestroy(() => document.removeEventListener('visibilitychange', onDocVis));
      // A re-entered route gets a fresh injector but the transport may be a
      // spec-supplied instance; either way the walkthrough starts from run 0.
      this.replayTransport.reset();

      // In record mode the fixture is the artifact being produced, so there is
      // nothing to await — the script drives the LIVE agent from the start.
      if (isRecordMode()) {
        this.announceReady();
        this.startWhenUnembedded();
        return;
      }

      try {
        await this.replayTransport.ready();
      } catch (err) {
        if (this.replayOnly) {
          console.error('hero recording unavailable; replay-only, so not going live', err);
          this.announceReady();
          return;
        }
        console.error('hero recording unavailable; staying live', err);
        this.mode.set('live');
        this.announceReady();
        return;
      }
      this.announceReady();
      this.startWhenUnembedded();
    } catch (err) {
      if (this.replayOnly) {
        console.error('hero boot failed; replay-only, so not going live', err);
        return;
      }
      console.error('hero boot failed; staying live', err);
      this.mode.set('live');
    }
  }

  /** Opened directly (or in record mode): no embedder will drive visibility. */
  private startWhenUnembedded(): void {
    if (typeof window !== 'undefined' && window.parent === window) this.setEmbedVisible(true);
    this.startRunner();
  }

  private startRunner(): void {
    this.runner?.stop();
    this.runner = new HeroScriptRunner(this);
    this.runner.setVisible(this.visible());
    this.bridge.postState(this.visible() ? 'scripted' : 'paused');
    void this.runner.loop();
  }

  /**
   * Posts `ready`, then — while embedded and still unanswered — keeps posting
   * it so a parent that missed the first exchange still learns the frame is up
   * and re-sends its visibility. Capped, because a page that is genuinely not
   * listening (an embedder that never implements the protocol) should not have
   * this frame talking to it forever.
   */
  private announceReady(): void {
    this.bridge.postState('ready');
    this.stopAnnouncingReady();
    if (this.embedderAnswered || !isEmbedded()) return;
    const deadline = Date.now() + HERO_READY_ANNOUNCE_MAX_MS;
    this.readyAnnounce = setInterval(() => {
      if (this.embedderAnswered || Date.now() >= deadline) {
        this.stopAnnouncingReady();
        return;
      }
      this.bridge.postState('ready');
    }, HERO_READY_ANNOUNCE_MS);
  }

  private stopAnnouncingReady(): void {
    if (this.readyAnnounce === null) return;
    clearInterval(this.readyAnnounce);
    this.readyAnnounce = null;
  }

  private setEmbedVisible(v: boolean): void {
    // Any visibility message — true or false — proves the embedder is on the
    // other end of the handshake, so the announcements have done their job.
    this.embedderAnswered = true;
    this.stopAnnouncingReady();
    this.embedVisible.set(v);
    this.applyVisibility();
  }

  private applyVisibility(): void {
    const v = this.visible();
    this.runner?.setVisible(v);
    if (this.mode() === 'replay' && this.runner) this.bridge.postState(v ? 'scripted' : 'paused');
  }

  /**
   * Focus moving into the surface is a takeover signal — unless WE moved it.
   * Pointerdown and the pill are never gated: a real click must always win.
   */
  onFocusIn(event?: FocusEvent): void {
    if (this.replayOnly) {
      // pointer-events: none stops clicks, but Tab can still reach the
      // composer; a visitor's keystrokes must not land in the recorded run.
      // Checked before `scriptDriving` (a visitor can Tab in mid-typing), and
      // blurring the composer's own post-submit refocus is harmless here.
      (event?.target as HTMLElement | null)?.blur?.();
      return;
    }
    if (this.scriptDriving) return;
    this.takeControl();
  }

  takeControl(): void {
    if (this.replayOnly || this.mode() === 'live') return;
    this.runner?.stop();
    this.runner = null;
    this.replayAgent.stop().catch((err) => console.warn('[hero] replay stop failed', err));
    this.clearComposer();
    this.cursorVisible.set(false);
    this.liveThreadId.set(null);
    this.mode.set('live');
    this.bridge.postState('live');
  }

  /**
   * A takeover mid-script can land while the walkthrough has half-typed a
   * prompt into the composer. Left alone, that text survives the swap to the
   * live agent and looks like the visitor's own (unsent) words.
   */
  private clearComposer(): void {
    const textarea = composerOf(this.surface());
    if (!textarea) return;
    textarea.value = '';
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  }

  replay(event?: Event): void {
    event?.stopPropagation();
    this.mode.set('replay');
    this.bridge.postState('replay');
    void this.restartReplay().then(() => this.startRunner());
  }

  protected sendLive(text: string): void {
    if (this.replayOnly) return;
    void this.liveAgent.submit({ message: text });
  }

  protected async onInterruptAction(action: InterruptAction): Promise<void> {
    const agent = this.activeAgent();
    const interrupt = agent.interrupt?.();
    if (!interrupt) return;

    let resume: unknown;
    switch (action) {
      case 'accept':
        resume = 'approved';
        break;
      case 'edit': {
        const reason = (interrupt.value as { reason?: string })?.reason ?? '';
        const edited = window.prompt(`Edit your response (current proposal: "${reason}"):`, 'approved');
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

    await agent.submit(null, { command: { resume } } as never);
  }

  // ── HeroScriptHost ────────────────────────────────────────────────────────

  async typeInto(text: string): Promise<void> {
    // Deliberately does NOT focus the textarea: that would trip the takeover.
    await this.driving(async () => {
      // Reduced motion writes the whole prompt in one tick. The reading pause
      // that used to be bolted on here for that case is now the runner's
      // HOLD_AFTER_TYPING_MS, which EVERY visitor gets — one beat, one number,
      // and no second pacing system hiding inside the host.
      await typeIntoTextarea(composerOf(this.surface()), text, TYPE_DELAY_MS, this.reducedMotion);
    });
  }

  async send(): Promise<void> {
    await this.driving(async () => {
      await this.pressWithCursor(sendButtonOf(this.surface()));
    });
  }

  async acceptInterrupt(): Promise<void> {
    await this.driving(async () => {
      // The visual press is cosmetic; the resume is resolved directly so a
      // relabelled Accept button cannot silently stall the walkthrough.
      this.cursorPressed.set(true);
      await sleep(this.reducedMotion ? 0 : 120);
      this.cursorPressed.set(false);
      await this.onInterruptAction('accept');
    });
  }

  async moveCursor(target: CursorTarget): Promise<void> {
    const root = this.surface();
    const el =
      target === 'composer' ? composerOf(root) : target === 'send' ? sendButtonOf(root) : acceptButtonOf(root);
    const point = cursorPointFor(root, el);
    if (!point) return;
    this.cursorX.set(point.x);
    this.cursorY.set(point.y);
    this.cursorVisible.set(true);
    // The same hold either way. Reduced motion loses the glide — the CSS
    // transition is off, so the cursor jumps — but the beat is "the pointer
    // deliberately went there", and the hold is what makes that legible with
    // or without the animation.
    await sleep(CURSOR_MOVE_MS);
  }

  hasInterrupt(): boolean {
    return !!this.activeAgent().interrupt?.();
  }

  isRunning(): boolean {
    return this.activeAgent().isLoading();
  }

  async restartReplay(): Promise<void> {
    this.replayTransport.reset();
    this.replayAgent.switchThread(null);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * Marks the window in which focus moves are ours. The flag clears a
   * macrotask AND a frame later, so the composer's post-submit
   * `requestAnimationFrame(() => textarea.focus())` still lands inside it.
   */
  private async driving(fn: () => Promise<void>): Promise<void> {
    this.scriptDriving = true;
    try {
      await fn();
    } finally {
      await sleep(0);
      await nextFrame();
      this.scriptDriving = false;
    }
  }

  private async pressWithCursor(el: HTMLButtonElement | null): Promise<void> {
    if (!el) return;
    this.cursorPressed.set(true);
    await sleep(this.reducedMotion ? 0 : 120);
    pressButton(el);
    this.cursorPressed.set(false);
  }

  private surface(): HTMLElement {
    return this.host.nativeElement.querySelector('[data-hero-surface]') as HTMLElement;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function nextFrame(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((r) => requestAnimationFrame(() => r()));
}
