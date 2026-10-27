/**
 * Default OpenGraph + Twitter share card for the marketing site.
 *
 * Renders a 1200x630 PNG at request time via Next.js ImageResponse. Per-route
 * overrides can be added by dropping an `opengraph-image.tsx` in any route
 * folder; today the blog is the only one that does.
 *
 * DESIGNED FOR FEED SIZE. Timelines render this around 500px wide and Slack
 * unfurls it narrower, so every size is chosen against that ~0.42x rendering
 * and nothing that has to be read falls below `MIN_READABLE_PX`.
 *
 * The card is the site: its ground, its rail rule and mono eyebrow, its
 * BrowserFrame, its pills, its wordmark — see `./card/chrome`. The card this
 * replaces was dark, centred, and assembled from a seam and a glow that exist
 * nowhere else, so the page it opened looked like a different product. It also
 * only ever asserted what Threadplane does. This one shows it: an agent
 * proposing an irreversible action and stopping for a human.
 */
import { ImageResponse } from 'next/og';
import { HERO_H1_LINES, HERO_SUBHEAD, POSITIONING_PROOF_POINTS, PRIMARY_TAGLINE } from '../lib/positioning';
import { loadCardFonts } from './og-font';
import { CARD } from './card/tokens';
import { Conversation, Frame, Pills, Rail, Wordmark } from './card/chrome';

export const runtime = 'nodejs';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

/** "LangGraph + AG-UI" — the first proof point is the runtime claim. */
const RUNTIMES = POSITIONING_PROOF_POINTS[0].label;
const EYEBROW = 'OPEN SOURCE';

/** Describes what the card actually shows, not just the page it links to. */
export const alt = `${PRIMARY_TAGLINE}. ${HERO_SUBHEAD} Beside the copy, a browser frame shows the product pausing for a human: an agent proposes deleting three backups, with Approve and Decline. Works with ${RUNTIMES}.`;

export default async function OpenGraphImage() {
  const fonts = await loadCardFonts({ mono: true });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          background: CARD.ground,
          fontFamily: 'Archivo, sans-serif',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', width: 600, padding: '58px 0 58px 64px', justifyContent: 'center' }}>
          <Rail text={EYEBROW} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 22,
              fontFamily: 'Archivo Black, sans-serif',
              fontSize: 60,
              lineHeight: 1.04,
              letterSpacing: '-0.02em',
              color: CARD.ink,
            }}
          >
            {HERO_H1_LINES.map((line) => (
              <div key={line} style={{ display: 'flex' }}>
                {line}
              </div>
            ))}
          </div>
          {/* Three lines. The subhead names every capability, and at 24px/470
              it ran to four and overlapped the pills — the column is centred in
              a fixed 630px card, so overflow collides rather than pushing. 530
              is the widest the 600px column's 64px left padding allows, and 20px
              is what holds three lines without orphaning the last two words. */}
          <div style={{ display: 'flex', marginTop: 20, fontSize: 20, lineHeight: 1.45, color: CARD.inkSecondary, maxWidth: 530 }}>
            {HERO_SUBHEAD}
          </div>
          <div style={{ display: 'flex', marginTop: 26 }}>
            <Pills runtimes={RUNTIMES} />
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Wordmark />
          </div>
        </div>

        {/* Absolutely positioned so the frame keeps its size whatever the copy does. */}
        <div style={{ display: 'flex', position: 'absolute', top: 150, left: 656 }}>
          <Frame width={480}>
            <Conversation />
          </Frame>
        </div>
      </div>
    ),
    { ...size, fonts },
  );
}
