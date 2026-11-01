import { Component, computed, input, ChangeDetectionStrategy } from '@angular/core';
import type { Spec } from '@json-render/core';
import { injectRenderHost } from '@threadplane/render';
import { emitBinding } from './emit-binding';

/** v0.9 TextField variant values ('date' was removed — DateTimeInput owns dates). */
type TextFieldVariant = 'longText' | 'number' | 'shortText' | 'obscured';

/** Maps v0.9 variant to HTML input[type] or textarea. */
const TYPE_MAP: Record<TextFieldVariant, string> = {
  shortText: 'text',
  longText: 'text',    // handled by textarea below
  number: 'number',
  obscured: 'password',
};

/** Renders an A2UI text, number, password, or multiline field and writes edits to its bound state. */
@Component({
  selector: 'a2ui-text-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="a2ui-tf">
      @if (label()) {
        <label [htmlFor]="_inputId" class="a2ui-tf__label">{{ label() }}</label>
      }
      @if (variant() === 'longText') {
        <textarea
          [id]="_inputId"
          [value]="value()"
          [placeholder]="placeholder()"
          rows="4"
          class="a2ui-tf__input"
          (input)="onInput($event)"
        ></textarea>
      } @else {
        <input
          [id]="_inputId"
          [type]="htmlInputType()"
          [value]="value()"
          [placeholder]="placeholder()"
          [pattern]="validationRegexp() || ''"
          class="a2ui-tf__input"
          (input)="onInput($event)"
        />
      }
      @if (errorText()) {
        <div class="a2ui-check-error" role="alert">{{ errorText() }}</div>
      }
    </div>
  `,
  styles: [`
    .a2ui-tf { display: flex; flex-direction: column; gap: var(--a2ui-spacing-1); }
    .a2ui-tf__label {
      font-size: var(--a2ui-typography-label-size);
      font-weight: var(--a2ui-typography-label-weight);
      color: var(--a2ui-label);
    }
    .a2ui-tf__input {
      padding: var(--a2ui-spacing-2) var(--a2ui-spacing-3);
      font-size: var(--a2ui-typography-body-size);
      border-radius: var(--a2ui-shape-small);
      background: var(--a2ui-input-bg);
      color: var(--a2ui-on-surface);
      border: 1px solid var(--a2ui-outline);
      outline: none;
      transition: border-color var(--a2ui-motion-duration-short) var(--a2ui-motion-easing-standard);
      resize: vertical;
    }
    .a2ui-tf__input:focus {
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
export class A2uiTextFieldComponent {
  private static _idCounter = 0;
  protected readonly _inputId = `a2ui-text-field-${++A2uiTextFieldComponent._idCounter}`;

  private readonly host = injectRenderHost();

  readonly label = input<string>('');
  /** v0.9 prop: resolved string value. */
  readonly value = input<string>('');
  readonly placeholder = input<string>('');
  /** v0.9 prop: input variant (default 'shortText'). */
  readonly variant = input<TextFieldVariant>('shortText');
  /** Enforced by the surface's check gate as an implicit regex rule (plus the native pattern attribute). */
  readonly validationRegexp = input<string>('');
  /** Live validation message written by the surface's check gate
   * (bound to /_a2uiChecks/<id>); empty when valid. */
  readonly errorText = input<string>('');
  readonly _bindings = input<Record<string, string>>({});
  // Framework inputs required by the render harness.
  readonly bindings = input<Record<string, string>>({});
  readonly loading = input<boolean>(false);
  readonly childKeys = input<string[]>([]);
  readonly spec = input<Spec | undefined>(undefined);

  protected readonly htmlInputType = computed(() =>
    TYPE_MAP[this.variant()] ?? 'text',
  );

  onInput(event: Event): void {
    const val = (event.target as HTMLInputElement | HTMLTextAreaElement).value;
    emitBinding(this.host, this._bindings(), 'value', val);
  }
}
