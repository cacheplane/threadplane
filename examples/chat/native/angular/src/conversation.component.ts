import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { filterLoadedTitles } from '../../shared/projection';
import { APPLICATION } from './application.token';
import { ComposerComponent } from './composer.component';
import { MessageComponent } from './message.component';

@Component({
  selector: 'native-conversation-view',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ComposerComponent, MessageComponent],
  template: `
    @let state = snapshot(); @let selection = state.selection;
    <div class="conversation-layout">
      <aside aria-labelledby="conversations-title">
        <h2 id="conversations-title">Loaded conversations</h2>
        <p class="muted">
          Browse up to 50 loaded conversations. The filter searches only loaded
          titles.
        </p>
        <div class="directory-actions">
          <button
            type="button"
            (click)="application.refresh()"
            [disabled]="state.list.status === 'pending'"
          >
            Refresh
          </button>
          <button
            type="button"
            (click)="application.newConversation()"
            [disabled]="state.creation.status === 'pending'"
          >
            New
          </button>
        </div>
        <label for="filter">Filter loaded conversations by title</label>
        <input
          id="filter"
          type="search"
          [value]="filter()"
          (input)="filterChanged($event)"
        />
        @if (state.list.status === 'pending') {
        <p role="status">Refreshing conversations…</p>
        } @if (state.list.status === 'error') {
        <p role="alert">Could not refresh loaded conversations.</p>
        } @if (state.creation.status === 'pending') {
        <p role="status">Creating conversation…</p>
        } @if (state.creation.status === 'unconfirmed') {
        <p role="alert">
          Creation could not be confirmed. A conversation may have been created;
          refresh before trying again.
        </p>
        }
        <ul class="conversation-list" aria-label="Loaded conversations">
          @for (row of rows(); track row.id) {
          <li>
            <button
              type="button"
              [attr.aria-current]="row.id === selection.id ? 'true' : null"
              (click)="application.select(row.id)"
            >
              {{ row.title }}
            </button>
          </li>
          }
        </ul>
        @if (state.list.status !== 'pending' && rows().length === 0) {
        <p class="muted">No loaded conversations match.</p>
        }
      </aside>
      <section class="conversation" aria-labelledby="conversation-title">
        <div class="conversation-heading">
          <p class="eyebrow">Angular example</p>
          <h1 id="conversation-title">
            {{ selection.row?.title ?? 'Your conversation' }}
          </h1>
          @if (selection.id) {
          <p class="conversation-id muted">
            Conversation ID: {{ selection.id }}
          </p>
          }
        </div>
        @switch (selection.status) { @case ('empty') {
        <div class="empty-state">
          <h2>A place for your next conversation.</h2>
          <p>Select a conversation or start a new one.</p>
        </div>
        } @case ('pending') {
        <p role="status">Loading conversation…</p>
        } @case ('missing') {
        <div class="selection-error">
          <p role="alert">Conversation not found.</p>
          <button type="button" (click)="application.retry()">Retry</button>
        </div>
        } @case ('error') {
        <div class="selection-error">
          <p role="alert">Could not load this conversation.</p>
          <button type="button" (click)="application.retry()">Retry</button>
        </div>
        } @case ('ready') {
        <div
          class="transcript"
          role="region"
          aria-label="Conversation messages"
        >
          @for (row of state.messages; track row.id) {
          <native-message [row]="row" />
          } @empty {
          <p class="empty-state">This conversation has no messages yet.</p>
          }
        </div>
        } }
        <native-composer
          [application]="application"
          [snapshot]="state"
          [selectionId]="selection.id"
        />
      </section>
    </div>
  `,
})
export class ConversationComponent {
  // This component exists only in the configured branch of AppComponent.
  readonly application = inject(APPLICATION)!;
  readonly snapshot = observeAgent(this.application);
  readonly filter = signal('');
  private readonly loadedRows = computed(() => this.snapshot().list.rows);
  readonly rows = computed(() =>
    filterLoadedTitles(this.loadedRows(), this.filter())
  );
  filterChanged(event: Event) {
    this.filter.set((event.target as HTMLInputElement).value);
  }
}
