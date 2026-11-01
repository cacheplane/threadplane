import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { injectRenderHost } from '@threadplane/render';
import { emitBinding } from './emit-binding';

/** Renders an A2UI checkbox that writes its checked value to the bound render state. */
@Component({
  selector: 'a2ui-check-box',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="a2ui-cb">
      <input type="checkbox" [checked]="value()" (change)="onChange($event)" class="a2ui-cb__input" />
      {{ label() }}
    </label>
    @if (errorText()) {
      <div class="a2ui-check-error" role="alert">{{ errorText() }}</div>
    }
  `,
  styles: [`
    .a2ui-cb {
      display: flex;
      align-items: center;
      gap: var(--a2ui-spacing-2);
      font-size: var(--a2ui-typography-body-size);
      cursor: pointer;
    }
    .a2ui-cb__input {
      width: 16px;
      height: 16px;
      border-radius: var(--a2ui-shape-extra-small);
      cursor: pointer;
      accent-color: var(--a2ui-primary);
    }
      .a2ui-check-error {
      font-size: var(--a2ui-typography-label-size);
      color: var(--a2ui-error, #d33d55);
    }
`],
})
export class A2uiCheckBoxComponent {
  private readonly host = injectRenderHost();

  readonly label = input<string>('');
  /** v0.9 prop: boolean checked state. */
  readonly value = input<boolean>(false);
  /** Live validation message written by the surface's check gate
   * (bound to /_a2uiChecks/<id>); empty when valid. */
  readonly errorText = input<string>('');
  readonly _bindings = input<Record<string, string>>({});
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  onChange(event: Event): void {
    const val = (event.target as HTMLInputElement).checked;
    emitBinding(this.host, this._bindings(), 'value', val);
  }
}
