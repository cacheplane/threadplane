import { Component, input } from '@angular/core';
import type { Spec } from '@json-render/core';
import {
  defineAngularRegistry,
  RenderSpecComponent,
} from '@threadplane/render';

@Component({
  selector: 'app-label',
  standalone: true,
  template: `<p>{{ label() }}</p>`,
})
export class LabelComponent {
  readonly label = input('');
}

@Component({
  selector: 'app-generated-view',
  standalone: true,
  imports: [RenderSpecComponent],
  template: `<render-spec [spec]="spec" [registry]="registry" />`,
})
export class GeneratedViewComponent {
  readonly registry = defineAngularRegistry({ Text: LabelComponent });
  readonly spec: Spec = {
    root: 'greeting',
    elements: {
      greeting: { type: 'Text', props: { label: 'Hello, Angular.' } },
    },
  };
}
