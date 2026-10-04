import type {
  ReactRenderRegistry,
  RenderViewProps,
} from '@threadplane/react/render';

function literal(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function Heading({ props, children, loading }: RenderViewProps) {
  return (
    <div className="render-heading">
      <h3 aria-busy={loading}>
        {literal(props.content) || (loading ? '…' : '')}
      </h3>
      {children}
    </div>
  );
}
function Value({ props, loading }: RenderViewProps) {
  const value =
    typeof props.value === 'string' ||
    (typeof props.value === 'number' && Number.isFinite(props.value))
      ? String(props.value)
      : '';
  return (
    <dl className="render-value" aria-busy={loading}>
      <dt>{literal(props.label)}</dt>
      <dd>{value || (loading ? '…' : '')}</dd>
    </dl>
  );
}
function Card({ props, children, loading }: RenderViewProps) {
  return (
    <article className="render-card">
      <h4 aria-busy={loading}>
        {literal(props.title) || (loading ? '…' : '')}
      </h4>
      {children}
    </article>
  );
}
export const localRegistry: ReactRenderRegistry = Object.freeze({
  Heading,
  Value,
  Card,
});
