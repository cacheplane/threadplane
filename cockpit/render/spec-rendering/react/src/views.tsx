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
function Text({ props, loading }: RenderViewProps) {
  return (
    <p aria-busy={loading}>{literal(props.content) || (loading ? '…' : '')}</p>
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
function Badge({ props, loading }: RenderViewProps) {
  return (
    <span className="render-badge" aria-busy={loading}>
      {literal(props.label) || (loading ? '…' : '')}
    </span>
  );
}
export const localRegistry: ReactRenderRegistry = Object.freeze({
  Heading,
  Text,
  Card,
  Badge,
});
