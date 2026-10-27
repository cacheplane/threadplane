import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { APPLICATION } from './application.token';
import { ConversationComponent } from './conversation.component';

@Component({
  selector: 'native-conversation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConversationComponent],
  template: `
    <div class="application">
      <header>
        <span class="brand-mark" aria-hidden="true"></span>Threadplane<span
          class="example-label"
          >Native conversation</span
        >
      </header>
      <main>
        @if (application) {
        <native-conversation-view />
        } @else {
        <section class="setup" role="status">
          <h1>Set up an assistant to begin</h1>
          <p>
            This example is not connected to an assistant yet. Configure an
            assistant before starting a conversation.
          </p>
        </section>
        }
      </main>
    </div>
  `,
})
export class AppComponent {
  readonly application = inject(APPLICATION);
}
