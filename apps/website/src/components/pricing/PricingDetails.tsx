import { TIERS, type TierSlug } from '../../../../../pricing/tiers.config';

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

export function PricingComparison() {
  return (
    <div className="pricing-comparison">
      <div className="pricing-section-heading-wrap">
        <h2 id="pricing-comparison-heading" className="pricing-section-heading">
          Choose your ground crew.
        </h2>
        <p className="pricing-section-body">
          The software is identical on every path — MIT, all of it. What
          changes is support. Community is free; Production Assurance and enterprise engagements are custom-priced. Pilot-to-Prod and agent builds are separately scoped delivery work.
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
