import {Component,DestroyRef,effect,inject} from '@angular/core';
import {observeAgent} from '@threadplane/angular';
import {selected,views,draw} from './state';

@Component({
  selector:'state-observer',standalone:true,
  template:'<section aria-label="Angular render state"><p>{{ label() }}</p><pre>{{ text() }}</pre></section>',
})
export class AngularView {
  // observeAgent captures this actual owner in this injection context.
  readonly snapshot=observeAgent(selected.angular);
  readonly label=()=>String(this.snapshot()['label']);
  readonly text=()=>JSON.stringify(this.snapshot());
  constructor() {
    effect(()=>{views.angular=this.snapshot(); draw();});
    inject(DestroyRef).onDestroy(()=>{delete views.angular;});
  }
}
