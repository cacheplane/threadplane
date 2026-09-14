import { WEBSITE_SUPPORTED_ANGULAR_MAJORS } from '../components/pricing/angular-support.mjs';

/**
 * The homepage airworthiness list: the figures a third party published about
 * this project, each linking to the body that published it.
 *
 * This used to be the tail of a 27-row preflight checklist with a Threadplane
 * column and an unticked Yours column (spec 2026-09-08). Both columns came
 * out on 2026-09-11: the section's job is trust, and the only half of it that
 * was not self-reported is this one. The three self-reported rows that lived
 * here (Cloud, Signup, VC board) went with them — the masthead above already
 * says "no account, no cloud" and the FAQ says the rest.
 *
 * Before adding a row: find the page that proves it. If there is no page, it
 * is not a row.
 */
export interface ChecklistRow {
  /** Left side of the line. 1–3 words. */
  readonly challenge: string;
  /** Right side. The figure itself, never a feature name. */
  readonly response: string;
  /** The page that proves it. */
  readonly href: string;
  /** Small trailing unit. */
  readonly unit?: string;
  /** Live badge rendered instead of `response` text. */
  readonly badgeSrc?: string;
}

/**
 * Verified 2026-09-11 against live sources. The rank and score drift — re-verify
 * on touch, and never "round up".
 */
export const AIRWORTHINESS: readonly ChecklistRow[] = [
  { challenge: 'Framework rank', response: '#11', unit: 'OF 122', href: 'https://hvtracker.net/categories/agent-frameworks/' },
  { challenge: 'OpenSSF Scorecard', response: '8.3', unit: '/ 10', href: 'https://scorecard.dev/viewer/?uri=github.com/cacheplane/threadplane' },
  {
    challenge: 'Supply-chain grade',
    // Deliberately empty: the badge is the response. It sits near an A-band
    // floor of 80 and has flipped grade several times in a month, so a
    // hardcoded number would be wrong on some days.
    response: '',
    badgeSrc: 'https://hvtracker.net/badge/threadplane.svg',
    href: 'https://hvtracker.net/agents/threadplane/',
  },
  {
    challenge: 'Angular support',
    // Derived, not typed: bumping a supported major must update the homepage
    // without anyone remembering to edit this file.
    response: `${WEBSITE_SUPPORTED_ANGULAR_MAJORS[0]}–${WEBSITE_SUPPORTED_ANGULAR_MAJORS.at(-1)}`,
    unit: 'CI-TESTED',
    href: 'https://www.npmjs.com/package/@threadplane/langgraph',
  },
  { challenge: 'Release provenance', response: 'SIGNED', unit: 'OIDC · SLSA', href: 'https://www.npmjs.com/package/@threadplane/chat' },
];
