import { TIERS, type TierSlug } from '../../../../../pricing/tiers.config';
import { Eyebrow } from '../ui/Eyebrow';

type ComparisonCells = Record<TierSlug, string>;

interface ComparisonRow {
  readonly label: string;
  readonly cells: ComparisonCells;
}

const ALL_INCLUDED: ComparisonCells = {
  community: 'Included',
  production_assurance: 'Included',
  enterprise: 'Included',
};

const COMPARISON_ROWS: readonly ComparisonRow[] = [
  { label: 'Public documentation and examples', cells: ALL_INCLUDED },
  {
    label: 'Private support channel',
    cells: {
      community: 'Not included',
      production_assurance: 'Included',
      enterprise: 'Included',
    },
  },
  {
    label: 'Response commitments',
    cells: {
      community: 'Not included',
      production_assurance: 'Defined scope',
      enterprise: 'Custom',
    },
  },
  {
    label: 'Architecture and implementation reviews',
    cells: {
      community: 'Not included',
      production_assurance: 'Included',
      enterprise: 'Included',
    },
  },
  {
    label: 'Security and procurement assistance',
    cells: {
      community: 'Not included',
      production_assurance: 'Included',
      enterprise: 'Included',
    },
  },
  {
    label: 'Pilot-to-Prod delivery',
    cells: {
      community: 'Not included',
      production_assurance: 'Optional',
      enterprise: 'Available',
    },
  },
  {
    label: 'Custom enablement and training',
    cells: {
      community: 'Not included',
      production_assurance: 'Optional',
      enterprise: 'Available',
    },
  },
];

export function ArchitectureBoundary() {
  return (
    <div className="pricing-boundary">
      <div className="pricing-section-heading-wrap">
        <div className="pricing-section-rail">
          <Eyebrow tone="accent" className="pricing-section-kicker">What you are buying</Eyebrow>
          <span className="pricing-section-rail-line" aria-hidden="true" />
        </div>
        <h2 id="pricing-value-heading" className="pricing-section-heading">
          Open software. Commercial support when you want it.
        </h2>
        <p className="pricing-section-body">
          Every Threadplane package and capability is available under MIT. Paid
          engagements add expertise, response commitments, and delivery
          support—not a different build or permission to use the software.
        </p>
      </div>
      <div
        className="pricing-boundary-flow"
        aria-label="Threadplane deployment architecture"
      >
        <div className="pricing-boundary-block">
          <span className="pricing-boundary-label">Your product</span>
          <strong>Your Angular application</strong>
        </div>
        <span className="pricing-boundary-arrow" aria-hidden="true">
          →
        </span>
        <div className="pricing-boundary-block" data-accent>
          <span className="pricing-boundary-label">MIT software</span>
          <strong>Threadplane UI packages</strong>
        </div>
        <span className="pricing-boundary-arrow" aria-hidden="true">
          →
        </span>
        <div className="pricing-boundary-block">
          <span className="pricing-boundary-label">Customer-operated</span>
          <strong>
            Your agent runtime, models, storage, and infrastructure
          </strong>
        </div>
      </div>
      <p className="pricing-boundary-note">
        Threadplane does not host your agents or conversations. Runtime
        behavior, durable persistence, retention, and infrastructure costs are
        determined by the connected backend and providers.
      </p>
    </div>
  );
}

export function PricingComparison() {
  return (
    <div className="pricing-comparison">
      <div className="pricing-section-heading-wrap">
        <div className="pricing-section-rail">
          <Eyebrow tone="accent" className="pricing-section-kicker">Full comparison</Eyebrow>
          <span className="pricing-section-rail-line" aria-hidden="true" />
        </div>
        <h2 id="pricing-comparison-heading" className="pricing-section-heading">
          What changes between paths.
        </h2>
        <p className="pricing-section-body">
          The software is identical on every path — MIT, all of it. What
          changes is support.
        </p>
      </div>
      <div className="pricing-comparison-scroll">
        {/* Explicit roles: the phone card layout sets display:block, which
            drops table semantics in some browsers. */}
        <table
          className="pricing-comparison-table"
          aria-label="Full plan comparison"
          role="table"
        >
          <thead role="rowgroup">
            <tr role="row">
              <th scope="col" role="columnheader" className="pricing-comparison-feature-col">
                Plan detail
              </th>
              {TIERS.map((tier) => (
                <th
                  key={tier.slug}
                  scope="col"
                  role="columnheader"
                  className="pricing-comparison-plan-col"
                  data-highlight={tier.highlight || undefined}
                >
                  {tier.displayName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {COMPARISON_ROWS.map((row) => (
              <tr key={row.label} role="row">
                <th scope="row" role="rowheader" className="pricing-comparison-row-heading">
                  {row.label}
                </th>
                {TIERS.map((tier) => (
                  <td
                    key={tier.slug}
                    role="cell"
                    data-label={tier.displayName}
                    data-highlight={tier.highlight || undefined}
                  >
                    {row.cells[tier.slug]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
