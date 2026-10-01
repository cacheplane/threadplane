import {
  RenderSpec,
  type ReactRenderRegistry,
  type RenderViewProps,
} from '@threadplane/react/render';
import type { TripSummaryRender } from '../../shared/trip-summary-render';

function text(props: RenderViewProps['props'], key: string): string {
  const value = props[key];
  if (typeof value !== 'string')
    throw new TypeError(`Prepared trip ${key} must be text.`);
  return value;
}
const registry: ReactRenderRegistry = {
  Trip: ({ props, children }) => (
    <section className="trip-summary" aria-label="Trip summary">
      <h4>{text(props, 'title')}</h4>
      {children}
    </section>
  ),
  Counts: ({ props }) => (
    <p className="trip-summary-counts">{text(props, 'text')}</p>
  ),
  Days: ({ props, children }) =>
    props['empty'] === true ? (
      <p>No days supplied.</p>
    ) : (
      <ol className="trip-summary-days">{children}</ol>
    ),
  Day: ({ props, children }) => (
    <li className="trip-summary-day">
      <h5>{text(props, 'label')}</h5>
      {props['empty'] === true ? <p>No stops</p> : children}
    </li>
  ),
  Places: ({ children }) => <ul>{children}</ul>,
  Place: ({ props }) => (
    <li className="trip-summary-place">{text(props, 'text')}</li>
  ),
  Note: ({ props }) => (
    <p className="trip-summary-note">{text(props, 'text')}</p>
  ),
};

export function TripSummary({
  prepared,
}: {
  readonly prepared: TripSummaryRender;
}) {
  return (
    <RenderSpec
      spec={prepared.spec}
      state={prepared.state}
      registry={registry}
    />
  );
}
