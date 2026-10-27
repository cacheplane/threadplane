import { Component, DestroyRef, effect, inject } from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { selected, views, draw } from './state';

@Component({
  selector: 'a2ui-observer',
  standalone: true,
  template:
    '<section aria-label="Angular A2UI observation"><pre>{{ text() }}</pre></section>',
})
export class AngularView {
  readonly snapshot = observeAgent(selected.angular);
  readonly text = () => JSON.stringify(this.snapshot());
  constructor() {
    effect(() => {
      views.angular = this.snapshot();
      draw();
    });
    inject(DestroyRef).onDestroy(() => {
      delete views.angular;
    });
  }
}
