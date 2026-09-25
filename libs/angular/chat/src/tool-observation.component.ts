import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/** Literal observed text. The caller owns tool/result association and formatting. */
@Component({
  selector: 'threadplane-tool-observation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section [attr.aria-label]="label()">
      <h3>{{ name() }}</h3>
      <dl>
        <dt>Arguments</dt>
        <dd>
          <pre>{{ argumentsText() }}</pre>
        </dd>
        @if (resultText() !== undefined) {
        <dt>Result</dt>
        <dd>
          <pre>{{ resultText() }}</pre>
        </dd>
        }
      </dl>
    </section>
  `,
  styles: `
    :host { display: block; color: var(--ds-text-primary, #142435); font-family: inherit; overflow-wrap: anywhere; }
    dl, dd { margin: 0; }
    dt { font-weight: 600; }
    pre { margin-block: .25rem; white-space: pre-wrap; overflow-wrap: anywhere; }
  `,
})
export class ToolObservationComponent {
  readonly name = input.required<string>();
  readonly argumentsText = input.required<string>();
  readonly resultText = input<string>();
  readonly label = input('Tool observation');
}
