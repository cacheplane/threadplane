import { Component, input, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { injectRenderHost } from '@threadplane/render';
import { emitBinding } from './emit-binding';

/** Renders an A2UI range input that writes numeric changes to its bound render state. */
@Component({
  selector: 'a2ui-slider',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="a2ui-slider">
      @if (label()) {
        <label [htmlFor]="_inputId" class="a2ui-slider__label">{{ label() }}: {{ value() }}</label>
      }
      <input
        [id]="_inputId"
        type="range"
        class="a2ui-slider__input"
        [min]="min()"
        [max]="max()"
        [value]="value()"
        (input)="onInput($event)"
      />
      @if (errorText()) {
      <div class="a2ui-check-error" role="alert">{{ errorText() }}</div>
    }
    </div>
  `,
  styles: [`
    .a2ui-slider { display: flex; flex-direction: column; gap: var(--a2ui-spacing-1); }
    .a2ui-slider__label {
      font-size: var(--a2ui-typography-label-size);
      font-weight: var(--a2ui-typography-label-weight);
      color: var(--a2ui-label);
    }
    .a2ui-slider__input {
      width: 100%;
      cursor: pointer;
      accent-color: var(--a2ui-primary);
    }
      .a2ui-check-error {
      font-size: var(--a2ui-typography-label-size);
      color: var(--a2ui-error, #d33d55);
    }
`],
})
export class A2uiSliderComponent {
  private static _idCounter = 0;
  protected readonly _inputId = `a2ui-slider-${++A2uiSliderComponent._idCounter}`;

  private readonly host = injectRenderHost();

  readonly label = input<string>('');
  /** v0.9 prop: value (resolved DynamicNumber). */
  readonly value = input<number>(0);
  /** v0.9 prop: lower bound (default 0). */
  readonly min = input<number>(0);
  /** v0.9 prop: upper bound. */
  readonly max = input<number>(100);
  /** Live validation message written by the surface's check gate
   * (bound to /_a2uiChecks/<id>); empty when valid. */
  readonly errorText = input<string>('');
  readonly _bindings = input<Record<string, string>>({});
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  onInput(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    emitBinding(this.host, this._bindings(), 'value', val);
  }
}
