import { Children, createContext, useContext, useId, useRef } from 'react';
import { useAgent } from '@threadplane/react';
import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderValue,
  type RenderViewProps,
} from '@threadplane/react/render';
import type { SurfaceView } from './application';
import type { BookingField } from './protocol';
import type { BookingSnapshot } from './form';

const empty = Object.freeze({
  model: Object.freeze({}),
  drafts: Object.freeze({}),
  errors: Object.freeze({}),
  valid: true,
});
const absentForm = Object.freeze({
  getSnapshot: () => empty,
  subscribe: () => () => undefined,
});
interface Borrowed {
  readonly surface: SurfaceView;
  readonly form: BookingSnapshot | typeof empty;
  readonly disabled: boolean;
  readonly focusInvalid: () => void;
}
const Context = createContext<Borrowed | null>(null);
function useSurface() {
  const context = useContext(Context);
  if (!context) throw Error('Missing surface presentation');
  return context;
}
const text = (value: RenderValue) =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
function Column({ children }: RenderViewProps) {
  return <div className="a2ui-column">{children}</div>;
}
function Row({ children }: RenderViewProps) {
  return <div className="a2ui-row">{children}</div>;
}
function List({ children }: RenderViewProps) {
  return (
    <ul className="a2ui-list">
      {Children.map(children, (child) => (
        <li>{child}</li>
      ))}
    </ul>
  );
}
function Card({ children }: RenderViewProps) {
  return <section className="a2ui-card">{children}</section>;
}
function Text({ props }: RenderViewProps) {
  const value = text(props.text);
  switch (props.variant) {
    case 'h1':
      return <h1>{value}</h1>;
    case 'h2':
      return <h2>{value}</h2>;
    case 'h3':
      return <h3>{value}</h3>;
    case 'h4':
      return <h4>{value}</h4>;
    case 'h5':
      return <h5>{value}</h5>;
    case 'caption':
      return <small>{value}</small>;
    default:
      return <span>{value}</span>;
  }
}
function Divider({ props }: RenderViewProps) {
  return (
    <div
      role="separator"
      aria-orientation={props.axis === 'vertical' ? 'vertical' : 'horizontal'}
      className="a2ui-divider"
    />
  );
}
function Control({
  props,
  bindings,
  elementKey,
  kind,
}: RenderViewProps & { readonly kind: 'choice' | 'date' | 'number' }) {
  const { surface, form, disabled } = useSurface();
  const field = (bindings?.value ?? '').slice(1) as BookingField;
  // Binding admission and field drafts belong to the application facade.
  const drafts = form.drafts as Readonly<Partial<Record<BookingField, string>>>;
  const errors = form.errors as Readonly<Partial<Record<BookingField, string>>>;
  const error = errors[field];
  const generated = useId();
  const id = generated + '-control',
    errorId = generated + '-error';
  const shared = {
    id,
    disabled,
    value: drafts[field] ?? '',
    'aria-invalid': !!error,
    'aria-describedby': error ? errorId : undefined,
    onChange: (event: { currentTarget: { value: string } }) => {
      if (!disabled) surface.edits[elementKey]?.(event.currentTarget.value);
    },
  };
  return (
    <div className="a2ui-field">
      <label htmlFor={id}>{text(props.label)}</label>
      {kind === 'choice' ? (
        <select {...shared}>
          <option value="">Choose…</option>
          {Array.isArray(props.options) &&
            props.options.map((option) => {
              const item = option as Readonly<Record<string, RenderValue>>;
              return (
                <option key={text(item.value)} value={text(item.value)}>
                  {text(item.label)}
                </option>
              );
            })}
        </select>
      ) : (
        <input
          {...shared}
          type={kind}
          {...(kind === 'number'
            ? { min: 1, step: 1, inputMode: 'numeric' as const }
            : {})}
        />
      )}
      {error && (
        <p id={errorId} role="alert" className="a2ui-error">
          {error}
        </p>
      )}
    </div>
  );
}
function ChoicePicker(props: RenderViewProps) {
  return <Control {...props} kind="choice" />;
}
function DateTimeInput(props: RenderViewProps) {
  return <Control {...props} kind="date" />;
}
function TextField(props: RenderViewProps) {
  return <Control {...props} kind="number" />;
}
function Button({ props, children, elementKey }: RenderViewProps) {
  const { surface, disabled, focusInvalid } = useSurface();
  return (
    <button
      type="button"
      disabled={disabled}
      className="a2ui-button"
      data-variant={text(props.variant)}
      onClick={() => {
        if (!disabled && !surface.actions[elementKey]?.()) focusInvalid();
      }}
    >
      {children}
    </button>
  );
}
/** Components stay stable across immutable model snapshots and React render replay. */
export const a2uiRegistry: ReactRenderRegistry = Object.freeze({
  Column,
  Row,
  List,
  Card,
  Text,
  Divider,
  ChoicePicker,
  DateTimeInput,
  TextField,
  Button,
});
/** A borrowed presentation lifetime never owns or disposes an application resource. */
export function A2uiSurface({
  surface,
  active,
}: {
  readonly surface: SurfaceView;
  readonly active: boolean;
}) {
  const form = useAgent<BookingSnapshot | typeof empty>(
    surface.form ?? absentForm
  );
  const container = useRef<HTMLElement>(null);
  return (
    <section
      ref={container}
      className="a2ui-surface"
      aria-label={active ? 'Current flight preview' : 'Earlier flight preview'}
    >
      {!active && <p className="a2ui-history">Earlier response · read only</p>}
      {surface.prose && <p className="a2ui-prose">{surface.prose}</p>}
      <Context.Provider
        value={{
          surface,
          form,
          disabled: !active,
          focusInvalid: () =>
            container.current
              ?.querySelector<HTMLElement>('[aria-invalid="true"]')
              ?.focus(),
        }}
      >
        <RenderSpec
          spec={surface.spec}
          registry={a2uiRegistry}
          state={surface.form ? form.model : surface.model}
        />
      </Context.Provider>
      <details className="a2ui-wire">
        <summary>Response details</summary>
        <pre>{surface.wire}</pre>
      </details>
    </section>
  );
}
