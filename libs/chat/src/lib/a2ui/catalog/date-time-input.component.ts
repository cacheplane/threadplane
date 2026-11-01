import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { injectRenderHost } from '@threadplane/render';
import { emitBinding } from './emit-binding';

/** Renders an A2UI date, time, or local date-time input and writes changes to its bound state. */
@Component({
  selector: 'a2ui-date-time-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="a2ui-dti">
      @if (label()) {
        <label [htmlFor]="_inputId" class="a2ui-dti__label">{{ label() }}</label>
      }
      <input
        [id]="_inputId"
        [type]="htmlInputType()"
        [value]="value()"
        [attr.min]="min() || null"
        [attr.max]="max() || null"
        class="a2ui-dti__input"
        (change)="onChange($event)"
      />
      @if (errorText()) {
      <div class="a2ui-check-error" role="alert">{{ errorText() }}</div>
    }
    </div>
  `,
  styles: [`
    .a2ui-dti { display: flex; flex-direction: column; gap: var(--a2ui-spacing-1); }
    .a2ui-dti__label {
      font-size: var(--a2ui-typography-label-size);
      font-weight: var(--a2ui-typography-label-weight);
      color: var(--a2ui-label);
    }
    .a2ui-dti__input {
      padding: var(--a2ui-spacing-2) var(--a2ui-spacing-3);
      font-size: var(--a2ui-typography-body-size);
      border-radius: var(--a2ui-shape-small);
      background: var(--a2ui-input-bg);
      color: var(--a2ui-on-surface);
      border: 1px solid var(--a2ui-outline);
      outline: none;
      transition: border-color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
    }
    .a2ui-dti__input:focus {
      outline: var(--a2ui-focus-ring-width) solid var(--a2ui-focus-ring-color);
      outline-offset: 2px;
      border-color: var(--a2ui-primary);
    }
      .a2ui-check-error {
      font-size: var(--a2ui-typography-label-size);
      color: var(--a2ui-error, #d33d55);
    }
`],
})
export class A2uiDateTimeInputComponent {
  private static _idCounter = 0;
  protected readonly _inputId = `a2ui-date-time-input-${++A2uiDateTimeInputComponent._idCounter}`;

  private readonly host = injectRenderHost();

  readonly label = input<string>('');
  /** v0.9 prop: ISO 8601 value (resolved DynamicString). Still renders when absent. */
  readonly value = input<string>('');
  /** v0.9 prop: enableDate — include date portion. */
  readonly enableDate = input<boolean>(true);
  /** v0.9 prop: enableTime — include time portion. */
  readonly enableTime = input<boolean>(false);
  /** v0.9 prop: ISO lower bound mapped to the native input's min. */
  readonly min = input<string | undefined>(undefined);
  /** v0.9 prop: ISO upper bound mapped to the native input's max. */
  readonly max = input<string | undefined>(undefined);
  /** Live validation message written by the surface's check gate
   * (bound to /_a2uiChecks/<id>); empty when valid. */
  readonly errorText = input<string>('');
  readonly _bindings = input<Record<string, string>>({});
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  /** Derives HTML input type from enableDate + enableTime. */
  protected readonly htmlInputType = computed<string>(() => {
    const d = this.enableDate();
    const t = this.enableTime();
    if (d && t) return 'datetime-local';
    if (t) return 'time';
    return 'date';
  });

  onChange(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    emitBinding(this.host, this._bindings(), 'value', val);
  }
}
