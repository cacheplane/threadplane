import {
  Component,
  inject,
  Injector,
  input,
  runInInjectionContext,
  signal,
  type OnInit,
  type Signal,
} from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { bootstrapApplication } from '@angular/platform-browser';
import { createFixtureSession } from './runtime-entry.js';
import {
  createThreadOwner,
  threadInstructions,
  type ThreadSelection,
} from './thread-owner';
import { display, type FixtureSnapshot } from './scenarios';

// The application owns execution outside component initialization/destruction.
const owner = createThreadOwner((id) => createFixtureSession('/api', id));

@Component({
  selector: 'thread-view',
  template: `
    <section class="panel" aria-label="Selected conversation">
      <h2>Selected conversation</h2>
      <div class="controls">
        <button (click)="loadSelected()">Load selected</button>
        <button (click)="run()">Run selected</button>
      </div>
      <div class="fields">
        <div>
          <h3>Thread</h3>
          <output data-testid="thread-id">{{ selected().id }}</output>
        </div>
        <div>
          <h3>Session generation</h3>
          <output data-testid="thread-generation">{{
            selected().generation
          }}</output>
        </div>
        <div>
          <h3>Status</h3>
          <output data-testid="thread-status">{{ snapshot().status }}</output>
        </div>
        <div>
          <h3>History request</h3>
          <output data-testid="thread-load">{{ load() }}</output>
        </div>
        <div>
          <h3>Run outcome</h3>
          <output data-testid="thread-outcome">{{ outcome() }}</output>
        </div>
        <div>
          <h3>Transcript</h3>
          <output data-testid="thread-text">{{ view().transcript }}</output>
        </div>
        <div>
          <h3>Values</h3>
          <output data-testid="thread-values">{{ view().values }}</output>
        </div>
        <div>
          <h3>Checkpoint history</h3>
          <output data-testid="thread-history">{{ view().history }}</output>
        </div>
      </div>
    </section>
  `,
})
export class ThreadView implements OnInit {
  readonly selected = input.required<ThreadSelection>();
  private readonly injector = inject(Injector);
  snapshot!: Signal<FixtureSnapshot>;
  readonly load = signal('unobserved');
  readonly outcome = signal('');
  // This component is keyed by selection identity. Its input never changes;
  // destruction releases observeAgent through this component's DestroyRef.
  ngOnInit() {
    this.snapshot = runInInjectionContext(this.injector, () =>
      observeAgent(this.selected().session)
    );
  }
  readonly view = () => display(this.snapshot());
  async loadSelected() {
    const selected = this.selected();
    this.load.set('loading');
    try {
      await selected.session.load?.();
      this.load.set('loaded');
    } catch {
      this.load.set('error');
    }
  }
  async run() {
    const selected = this.selected();
    this.outcome.set('running');
    try {
      this.outcome.set(
        await selected.session.submit(
          selected.id === 'thread-a' ? 'Hold A' : 'Send B'
        )
      );
    } catch {
      this.outcome.set('error');
    }
  }
}

@Component({
  selector: 'app-root',
  imports: [ThreadView],
  template: `
    <main class="review-shell">
      <header>
        <p class="eyebrow">Installed package review · Angular</p>
        <h1>Thread lifetime</h1>
      </header>
      <section class="panel">
        <h2>Review sequence</h2>
        <p>{{ instructions }}</p>
      </section>
      <section class="panel" aria-label="Thread owner">
        <h2>Application selection</h2>
        <div class="controls">
          <button (click)="select('thread-a')">Select A</button>
          <button (click)="select('thread-b')">Select B</button>
          <button (click)="dispose()">Dispose selected</button>
        </div>
        <h3>Owner</h3>
        <output data-testid="thread-owner">{{ state() }}</output>
      </section>
      @for (entry of [selected()]; track entry) {
      <thread-view [selected]="entry" />
      }
    </main>
  `,
})
export class ThreadApp {
  readonly instructions = threadInstructions;
  readonly selected = signal(owner.selected);
  readonly state = signal('active');
  select(id: ThreadSelection['id']) {
    this.selected.set(owner.select(id));
  }
  async dispose() {
    await owner.dispose();
    this.state.set('disposed');
  }
}

void bootstrapApplication(ThreadApp);
