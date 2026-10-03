import type {
  ReactRenderRegistry,
  RenderViewProps,
} from '@threadplane/react/render';

function display(value: unknown): string | number {
  return typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
    ? value
    : '';
}
function Heading({ props, children, loading }: RenderViewProps) {
  return (
    <div className="render-heading">
      <h3 aria-busy={loading}>
        {display(props.content) || (loading ? '…' : '')}
      </h3>
      {children}
    </div>
  );
}
function Text({ props, loading }: RenderViewProps) {
  const value = display(props.content);
  return <p aria-busy={loading}>{value === '' && loading ? '…' : value}</p>;
}
function Label({ props, loading }: RenderViewProps) {
  const value = display(props.value);
  return (
    <p className="render-label" aria-busy={loading}>
      <strong>{display(props.label)}</strong>
      <span>{value === '' && loading ? '…' : value}</span>
    </p>
  );
}
function Card({ props, children, loading }: RenderViewProps) {
  return (
    <article className="render-card">
      <h4 aria-busy={loading}>
        {display(props.title) || (loading ? '…' : '')}
      </h4>
      {children}
    </article>
  );
}
export const localRegistry: ReactRenderRegistry = Object.freeze({
  Heading,
  Text,
  Label,
  Card,
});
