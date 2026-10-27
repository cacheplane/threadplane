import { Component, DestroyRef, effect, inject } from '@angular/core';
import { observeAgent } from '@threadplane/angular';
import { MarkdownComponent } from '@threadplane/angular/markdown';
import { angularObserver, views, renders, draw } from './presentation-state';

@Component({
  selector: 'presentation-angular',
  standalone: true,
  imports: [MarkdownComponent],
  template:
    '<section aria-label="Angular native Markdown"><threadplane-markdown [snapshot]="snapshot()" /></section>',
})
export class PresentationAngular {
  readonly snapshot = observeAgent(angularObserver);
  constructor() {
    effect(() => {
      views.angular = this.snapshot();
      renders.angular++;
      draw();
    });
    inject(DestroyRef).onDestroy(() => {
      delete views.angular;
      draw();
    });
  }
}
