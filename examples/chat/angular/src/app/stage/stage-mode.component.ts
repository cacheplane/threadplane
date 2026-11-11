import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  EnvironmentInjector,
  InjectionToken,
  afterNextRender,
  createEnvironmentInjector,
  effect,
  inject,
  signal,
  viewChild,
  type Provider,
  type WritableSignal,
} from '@angular/core';
import {
  ChatComponent,
  ChatInterruptPanelComponent,
  createAgentRef,
  type AgentRef,
  type InterruptAction,
} from '@threadplane/chat';
import { ChatDebugComponent } from '@threadplane/chat/debug';
import { stagePresentationAgent } from './stage-interaction';
import { stageWheelOwnership } from './stage-wheel';
import {
  FetchStreamTransport,
  injectAgent,
  provideAgent,
  type AgentConfig,
  type LangGraphAgent,
} from '@threadplane/langgraph';
import { environment } from '../../environments/environment';
import { demoViews } from '../demo-views';
import { browserStageBridge, type StageBridge, type StageState } from './stage-bridge';
import { StageController } from './stage-controller';
import { StageRecordingTransport } from './stage-recording.transport';
import { StageReplayTransport } from './stage-replay.transport';
import { StageScript, STAGE_PROMPTS, type StageScriptHost } from './stage-script';
import type { StageTimeline } from './stage-timeline';
import { presentStageSeek } from './stage-rewind';

declare global {
  interface Window {
    /** Published in replay mode so a still recorder can map scroll to time. */
    __stageTimeline?: StageTimeline;
    /** The applied state of the last settled seek; the still recorder waits on it. */
    __stageApplied?: StageState;
  }
}

/** The one stage agent: replay-backed normally, live + recording under `?record=1`. */
export const STAGE_REF = createAgentRef<Record<string, unknown>>('stage');

/** Held per component instance, not at module scope: a re-entered route starts clean. */
const STAGE_THREAD_ID = new InjectionToken<WritableSignal<string | null>>('STAGE_THREAD_ID');
/** The recording transport in record mode; null in replay mode. */
const STAGE_RECORDING = new InjectionToken<StageRecordingTransport | null>('STAGE_RECORDING');

/**
 * Same filter the demo shell and the hero apply: the canonical graph has
 * side-effect LLM nodes (generate_title) whose tokens must not land on the
 * just-completed answer, which would trip the streaming-markdown contract and
 * stop the NEXT turn from rendering. The replay agent needs it too — the
 * recording carries the same events the live run did.
 */
const TRANSCRIPT_NODE_NAMES = ['generate'];

/** How long the record host waits to observe a submitted run actually starting. */
const RUN_START_CAP_MS = 2000;
/** How long the record host waits for a reload's history refresh to land. */
const RELOAD_CAP_MS = 10_000;
const POLL_MS = 50;

/**
 * Where the devtools panel sits, by frame width. `none` is the phone path: the
 * website renders stills there, so a docked panel would only eat the chat.
 */
export type StageDock = 'right' | 'bottom' | 'none';

const WIDE_QUERY = '(min-width: 1024px)';
const MEDIUM_QUERY = '(min-width: 768px)';

/** SSR/test-safe: without `matchMedia` we assume the wide frame the stage is authored for. */
function readStageDock(): StageDock {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'right';
  if (window.matchMedia(WIDE_QUERY).matches) return 'right';
  if (window.matchMedia(MEDIUM_QUERY).matches) return 'bottom';
  return 'none';
}

function isRecordMode(): boolean {
  if (environment.production || typeof location === 'undefined') return false;
  return new URLSearchParams(location.search).get('record') === '1';
}

/**
 * `provideAgent()` registers the shared AGENT token and aliases the ref to it,
 * so two calls in ONE providers array collapse into a single agent. One child
 * environment injector per agent keeps that from biting if the stage ever
 * grows a second one.
 */
function scopedAgent(ref: AgentRef<Record<string, unknown>>, config: AgentConfig): LangGraphAgent {
  const injector = createEnvironmentInjector(provideAgent(ref, config), inject(EnvironmentInjector));
  inject(DestroyRef).onDestroy(() => injector.destroy());
  return injector.get(ref.token) as LangGraphAgent;
}

function stageProviders(replay?: StageReplayTransport): Provider[] {
  return [
    // useFactory, not useValue: this array is built once at decorator time, so
    // a `new StageReplayTransport()` here would be a module singleton carrying
    // its run index across route re-entries.
    { provide: StageReplayTransport, useFactory: () => replay ?? new StageReplayTransport() },
    { provide: STAGE_THREAD_ID, useFactory: () => signal<string | null>(null) },
    {
      provide: STAGE_RECORDING,
      useFactory: () => {
        if (!isRecordMode()) return null;
        const threadId = inject(STAGE_THREAD_ID);
        let rec: StageRecordingTransport | null = null;
        const inner = new FetchStreamTransport(environment.langGraphApiUrl, (id: string) => {
          threadId.set(id);
          rec?.onThreadId(id);
        });
        rec = new StageRecordingTransport(inner);
        return rec;
      },
    },
    {
      provide: STAGE_REF.token,
      useFactory: () => {
        const threadId = inject(STAGE_THREAD_ID);
        const recording = inject(STAGE_RECORDING);
        if (recording) {
          return scopedAgent(STAGE_REF, {
            apiUrl: environment.langGraphApiUrl,
            assistantId: environment.assistantId,
            threadId,
            onThreadId: (id: string) => threadId.set(id),
            transport: recording,
            transcriptNodeNames: TRANSCRIPT_NODE_NAMES,
            subagentToolNames: ['research'],
          });
        }
        return scopedAgent(STAGE_REF, {
          assistantId: 'stage-replay',
          threadId,
          transport: inject(StageReplayTransport),
          transcriptNodeNames: TRANSCRIPT_NODE_NAMES,
          subagentToolNames: ['research'],
        });
      },
    },
  ];
}

@Component({
  selector: 'stage-mode',
  standalone: true,
  imports: [ChatComponent, ChatInterruptPanelComponent, ChatDebugComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: stageProviders(),
  template: `
    <div class="stage" [attr.data-phase]="controller()?.phase()" [attr.data-dock]="inspectionDock() ?? dock()" [attr.data-debug-open]="debugOpen()">
      <div class="stage__bar">
        <span class="stage__url">demo.threadplane.ai</span>
        <span class="stage__pill" data-stage-pill [attr.data-live]="recording !== null">
          <span class="stage__dot" aria-hidden="true"></span>
          @if (recording !== null) {
            Recording a live LangGraph run
          } @else {
            Replaying a recorded LangGraph run
          }
        </span>
        <a class="stage__open" href="/embed" target="_top">Open the live demo ↗</a>
      </div>
      <div class="stage__surface">
        <div class="stage__column">
          <div
            class="stage__interrupt"
            data-stage-interrupt
            role="region"
            aria-label="Approval required"
          >
            @if (agent.interrupt?.()) {
              <chat-interrupt-panel [agent]="agent" (action)="onInterruptAction($event)" />
            }
          </div>
          <chat [agent]="presentationAgent" [views]="catalog"></chat>
        </div>
        <!-- The dock input is read once (the panel restores it after the first
             render), so the two docks are two ELEMENTS under distinct storage
             keys, not one element with a bound input. -->
        @if (dock() === 'right') {
          <chat-debug
            [agent]="debugAgent"
            dock="right"
            [defaultOpen]="true"
            launcher="floating"
            (replayRequested)="openLiveDemo()"
            (forkRequested)="openLiveDemo()"
            (dockChange)="inspectionDock.set($event)"
            [storageKey]="storageKey + '-right'"
            (openChange)="onDebugOpenChange($event)"
          />
        } @else if (dock() === 'bottom') {
          <chat-debug
            [agent]="debugAgent"
            dock="bottom"
            [defaultOpen]="true"
            launcher="floating"
            (replayRequested)="openLiveDemo()"
            (forkRequested)="openLiveDemo()"
            (dockChange)="inspectionDock.set($event)"
            [storageKey]="storageKey + '-bottom'"
            (openChange)="onDebugOpenChange($event)"
          />
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host { display: block; height: 100%; }
      .stage { display: flex; flex-direction: column; height: 100%; }
      .stage__bar { display: flex; align-items: center; gap: 12px; padding: 6px 12px; font: 12px/1.3 system-ui, sans-serif; border-bottom: 1px solid rgba(128,128,128,.25); }
      .stage__url { opacity: .6; }
      .stage__pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; border: 1px solid #b5731a; color: #b5731a; }
      .stage__pill[data-live='true'] { border-color: #2f6f4f; color: #2f6f4f; }
      .stage__dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
      .stage__open { margin-left: auto; color: inherit; opacity: .7; }
      .stage__surface { position: relative; flex: 1; min-height: 0; display: flex; }
      /* chat-debug's right dock is position: fixed at width: var(--panel-size, 420px)
         (libs/chat/debug/.../chat-debug.component.ts, .panel--right), so it is out of
         flow and would sit ON TOP of the transcript. 420 + 16 gutter = 436px. */
      .stage__column { flex: 1; min-width: 0; display: flex; flex-direction: column; }
      .stage[data-dock='right'][data-debug-open='true'] .stage__column { padding-right: var(--stage-devtools-width, 436px); }
      .stage[data-dock='left'][data-debug-open='true'] .stage__column { padding-left: var(--stage-devtools-width, 436px); }
      /* The bottom dock is fixed to the viewport bottom at 40vh; below 768px no
         panel renders at all, so the column keeps its full height. */
      .stage[data-dock='bottom'][data-debug-open='true'] .stage__column { padding-bottom: 40vh; }
      .stage__column > chat { flex: 1; min-height: 0; }
      .stage__interrupt:empty { display: none; }
      .stage__interrupt { padding: 8px 12px 0; }
    `,
  ],
})
export class StageMode {
  /** TEST SEAM. Substitutes a preloaded replay transport so no fetch is made. */
  static providersForTest(replay?: StageReplayTransport): Provider[] {
    return stageProviders(replay);
  }

  /** TEST SEAM. Markup specs must not boot a replay on real timers. */
  static autoBoot = true;
  static disableAutoBootForTests(): void {
    StageMode.autoBoot = false;
  }
  static enableAutoBoot(): void {
    StageMode.autoBoot = true;
  }

  private readonly destroyRef = inject(DestroyRef);
  private readonly replayTransport = inject(StageReplayTransport);
  private readonly threadId = inject(STAGE_THREAD_ID);
  /** Non-null only in record mode. */
  protected readonly recording = inject(STAGE_RECORDING);
  protected readonly agent = injectAgent(STAGE_REF) as LangGraphAgent;
  protected readonly presentationAgent = this.recording
    ? this.agent
    : stagePresentationAgent(this.agent, () => this.openLiveDemo());
  protected readonly debugOpen = signal(true);
  private exploring = false;
  protected readonly inspectionDock = signal<'left' | 'right' | 'bottom' | null>(null);

  protected openLiveDemo(): void {
    window.open(new URL('/embed', window.location.href).href, '_top');
  }
  /**
   * The devtools' agent contract types `state` as `Signal<Record<string,
   * unknown>>` while the untyped LangGraph agent exposes `Signal<unknown>`, so
   * the SAME object needs a cast at this one read site. `DebugAgentWithHistory`
   * is not exported from `@threadplane/chat/debug`, so the with-history half of
   * the input's union is extracted from the input type itself — the panel's
   * Timeline tab only appears for an agent that carries `history`.
   */
  protected readonly debugAgent = this.agent as unknown as Extract<
    NonNullable<ReturnType<ChatDebugComponent['agent']>>,
    { history: unknown }
  >;
  protected readonly catalog = demoViews();

  /**
   * Per-load key. The panel persists `open` under its storage key and closes
   * itself on any document click, so a shared key would carry `open: false`
   * into the next load and the stage would render with no devtools at all.
   */
  protected readonly storageKey = `stage-debug-${Date.now()}`;
  protected readonly dock = signal<StageDock>(readStageDock());
  private readonly chat = viewChild(ChatComponent);

  readonly timeline = signal<StageTimeline | null>(null);
  readonly controller = signal<StageController | null>(null);

  /** TEST SEAM. Replaced by the spec; browser bridge by default. */
  bridge: StageBridge =
    typeof window === 'undefined'
      ? {
          onSeek: () => () => undefined,
          onExplore: () => () => undefined,
          postReady: () => undefined,
          postState: () => undefined,
          postExplore: () => undefined,
          postWheel: () => false,
        }
      : browserStageBridge();

  private lastPosted = '';
  private seekTarget: number | null = null;
  private seekFrame: number | null = null;
  private presenting = false;
  private pinFrame: number | null = null;
  /** A publish landed while a pin pair was in flight; one more pair follows it. */
  private pinPending = false;

  constructor() {
    this.watchDock();
    if (!this.recording && typeof window !== 'undefined') {
      this.destroyRef.onDestroy(this.bridge.onExplore((value) => { this.exploring = value; }));
      this.destroyRef.onDestroy(stageWheelOwnership(window, () => this.exploring,
        (x, y) => this.bridge.postWheel(x, y),
        () => { this.exploring = false; this.bridge.postExplore(false); }));
    }
    this.destroyRef.onDestroy(() => {
      if (typeof cancelAnimationFrame === 'function') {
        if (this.seekFrame !== null) cancelAnimationFrame(this.seekFrame);
        if (this.pinFrame !== null) cancelAnimationFrame(this.pinFrame);
      }
      this.seekFrame = null;
      this.pinFrame = null;
      this.pinPending = false;
    });
    afterNextRender(() => {
      if (StageMode.autoBoot) {
        void this.boot(new URLSearchParams(typeof location === 'undefined' ? '' : location.search));
      }
    });
    effect(() => {
      const c = this.controller();
      if (!c) return;
      this.publish({ applied: c.applied(), phase: c.phase(), t: c.t() });
    });
  }

  /** Let the panel close normally; its floating launcher can reopen it. */
  protected onDebugOpenChange(open: boolean): void {
    this.debugOpen.set(open);
  }

  /** Re-reads the dock whenever the frame crosses a breakpoint. */
  private watchDock(): void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const update = () => {
      this.inspectionDock.set(null);
      this.dock.set(readStageDock());
    };
    for (const query of [WIDE_QUERY, MEDIUM_QUERY]) {
      const mql = window.matchMedia(query);
      // `addEventListener` is missing on older MediaQueryList shims (and on the
      // stubs a spec installs), so an absent listener must not break the stage.
      if (typeof mql?.addEventListener !== 'function') continue;
      mql.addEventListener('change', update);
      this.destroyRef.onDestroy(() => mql.removeEventListener('change', update));
    }
  }

  /** Public so a spec (or the still recorder's harness) can boot explicitly. */
  async boot(params: URLSearchParams): Promise<void> {
    try {
      if (this.recording) {
        await this.record();
        return;
      }
      const tl = await this.replayTransport.ready();
      this.timeline.set(tl);
      if (typeof window !== 'undefined') window.__stageTimeline = tl;
      const controller = new StageController(
        this.agent,
        this.replayTransport,
        tl,
        await this.replayTransport.recordingData(),
      );
      this.controller.set(controller);
      // Seeks are subscribed before `ready` is posted: with an empty referrer
      // the bridge learns the parent origin from the parent's first message
      // and re-posts `ready` from inside that handler, so the listener must
      // already exist. The controller is set above, so an early seek applies.
      const off = this.bridge.onSeek((t) => this.requestSeek(t));
      this.destroyRef.onDestroy(off);
      const reload = tl.runs.find((r) => r.run.action.kind === 'reload');
      this.bridge.postReady({
        totalMs: tl.totalMs,
        beats: tl.beats,
        hold: tl.hold,
        reloadEndMs: reload ? reload.endMs : null,
      });
      await controller.seek(Number(params.get('t')) || 0);
      // Published here as well as from the effect: `await boot()` must imply
      // the applied state is observable, without waiting on a render pass.
      this.publish({ applied: controller.applied(), phase: controller.phase(), t: controller.t() });
    } catch (err) {
      console.error('[stage] boot failed', err);
    }
  }

  /**
   * One `controller.seek()` per animation frame, last target wins: a scroll
   * burst posts far more targets than the agent's non-re-entrant submit path
   * can absorb.
   */
  requestSeek(t: number): void {
    this.seekTarget = t;
    if (typeof requestAnimationFrame !== 'function') {
      void this.controller()?.seek(t);
      return;
    }
    if (this.seekFrame !== null || this.presenting) return;
    this.seekFrame = requestAnimationFrame(() => {
      this.seekFrame = null;
      const target = this.seekTarget;
      this.seekTarget = null;
      const controller = this.controller();
      if (target === null || !controller) return;
      this.presenting = true;
      void presentStageSeek(target, controller, () => new Promise<void>((resolve) => {
        // Rendering is paused during the transition callback. Use a task,
        // not rAF, to let Angular settle before capturing the new frame.
        setTimeout(() => {
          this.chat()?.scrollToBottom();
          resolve();
        }, 32);
      })).then(() => {
        this.publish({ applied: controller.applied(), phase: controller.phase(), t: controller.t(), settled: true });
      }).catch((err: unknown) => console.warn('[stage] presentation failed', err)).finally(() => {
        this.presenting = false;
        if (!this.destroyRef.destroyed && this.seekTarget !== null) this.requestSeek(this.seekTarget);
      });
    });
  }

  protected async onInterruptAction(action: InterruptAction): Promise<void> {
    if (!this.recording) {
      this.openLiveDemo();
      return;
    }
    await this.agent.submit(null, {
      command: { resume: action === 'accept' ? 'approved' : 'denied' },
    } as never);
  }

  private publish(state: StageState): void {
    const key = `${state.applied}|${state.phase}|${state.t}|${state.settled ?? false}`;
    if (key === this.lastPosted) return;
    this.lastPosted = key;
    this.bridge.postState(state);
    if (typeof window !== 'undefined') window.__stageApplied = state;
    if (!state.settled) this.pinTranscript();
  }

  /**
   * Pins the transcript to its newest content once a seek has settled. The
   * chat scrolls itself on each new message and on each token while pinned,
   * but a seek applies a whole run in one burst, so its last
   * `scrollTop = scrollHeight` write lands BEFORE the registered tool view
   * (the backup table), the A2UI surface, and the interrupt panel — which sits
   * above the chat and shrinks it — have rendered, and the newest content ends
   * up below the fold: at the hold the transcript sat ~700px above its bottom.
   * Live token cadence hides the same gap.
   *
   * Scheduling: one pair of frames is in flight at a time — the views render
   * in the first, layout settles in the second, and the scroll write lands at
   * the end of the second. A publish that arrives while a pair is in flight
   * re-arms exactly one more pair after it, so content that renders after
   * the pending pair's inner frame is still pinned rather than dropped.
   *
   * This deliberately overrides the chat's own unpin-on-user-scroll: the
   * stage is a scrubbed display surface, not a reading surface, so a viewer
   * who scrolls up is re-pinned on the next applied seek.
   *
   * The write goes through `ChatComponent.scrollToBottom()`, which counts it
   * as programmatic so the chat's own scroll handler does not read it as the
   * user unpinning.
   */
  private pinTranscript(): void {
    if (typeof requestAnimationFrame !== 'function') return;
    if (this.pinFrame !== null) {
      this.pinPending = true;
      return;
    }
    this.pinFrame = requestAnimationFrame(() => {
      // The pair now owns every publish that arrived before this frame fired.
      this.pinPending = false;
      this.pinFrame = requestAnimationFrame(() => {
        this.pinFrame = null;
        this.chat()?.scrollToBottom();
        if (this.pinPending) {
          this.pinPending = false;
          this.pinTranscript();
        }
      });
    });
  }

  // ── Record mode ───────────────────────────────────────────────────────────

  /** Drives the five beats against the LIVE agent, producing the recording. */
  private async record(): Promise<void> {
    const rec = this.recording;
    if (!rec) return;
    const agent = this.agent;
    let researchCheckpointId: string | undefined;
    // A run is only "done" for the recording once its closing history refresh
    // has landed: the bridge refreshes history after a run closes, and a next
    // run started before that lands cancels the refresh, leaving the previous
    // run without a snapshot for the replay's getHistory() to serve. A run
    // that closes on an interrupt is the exception — the bridge finalizes it
    // as the interrupt arrives and skips the refresh, in replay as in record.
    const settle = async (run: Promise<unknown>): Promise<void> => {
      const before = rec.recording().histories.length;
      await waitUntil(() => agent.isLoading(), RUN_START_CAP_MS);
      await run;
      await waitUntil(
        () =>
          !agent.isThreadLoading() &&
          (rec.recording().histories.length > before || !!agent.interrupt?.()),
        RELOAD_CAP_MS,
      );
    };
    const host: StageScriptHost = {
      beginRun: (beat, action) => rec.beginRun(beat, action),
      submit: async (message, checkpointIndex) => {
        const checkpointId =
          checkpointIndex !== undefined ? agent.history()[checkpointIndex]?.id : undefined;
        await settle(agent.submit({ message }, checkpointId ? ({ checkpointId } as never) : undefined));
        if (message === STAGE_PROMPTS.subagents) researchCheckpointId = agent.history()[0]?.id;
      },
      resume: async (value) => {
        await settle(agent.submit(null, { command: { resume: value } } as never));
      },
      reload: async () => {
        // The reload's snapshot is stamped with the run count at the moment
        // markReload() fires, so it MUST wait for the adoption's history
        // refresh: closing the run first stamps an index the replay's
        // getHistory() (which keys on runIndex) can never serve.
        const id = this.threadId();
        agent.switchThread(null);
        // Baseline AFTER the detach has been given a turn: a refresh still in
        // flight from the previous beat would otherwise land and satisfy the
        // growth check below without the adoption having refreshed at all.
        await sleep(0);
        const before = rec.recording().histories.length;
        agent.switchThread(id);
        await waitUntil(
          () => !agent.isThreadLoading() && rec.recording().histories.length > before,
          RELOAD_CAP_MS,
        );
        rec.markReload();
      },
      isRunning: () => agent.isLoading(),
      hasInterrupt: () => !!agent.interrupt?.(),
      forkIndex: () => {
        // Capture the completed research turn before the 90-day proposal:
        // the alternative keeps both sources and the child's findings.
        const i = agent.history().findIndex((s) => s.id === researchCheckpointId);
        if (i < 0) throw new Error('stage research checkpoint missing; refusing to fork without the saved research');
        return i;
      },
      sleep,
    };
    await new StageScript(host).run();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Polls `pred` until true or the cap elapses; never throws, so a slow run still records. */
async function waitUntil(pred: () => boolean, capMs: number): Promise<void> {
  const deadline = Date.now() + capMs;
  while (!pred()) {
    if (Date.now() >= deadline) {
      console.warn('[stage] record host wait timed out');
      return;
    }
    await sleep(POLL_MS);
  }
}
