/**
 * The repository's GitHub Social Preview card.
 *
 * GitHub serves an auto-generated card — avatar, repo name, description, star
 * count — for any repository with no preview image uploaded. That generic card
 * is what a link to this repo rendered as on X, and no amount of website
 * metadata changes it: GitHub's og:image points at its own renderer, and it
 * never reads the README's banner.
 *
 * There is no API for the upload. `scripts/export-github-card.mjs` writes this
 * route's output to docs/brand/github-social-preview.png and a maintainer
 * uploads it by hand (see docs/brand/README.md).
 *
 * Built from the same primitives as the feed card in `../opengraph-image.tsx`,
 * so the two cannot drift into two different brands. It is not a resized copy
 * of it — see the ratio and type notes below.
 */
import { ImageResponse } from 'next/og';
import { HERO_H1_LINES, HERO_SUBHEAD, POSITIONING_PROOF_POINTS, PRIMARY_TAGLINE } from '../../lib/positioning';
import { loadCardFonts } from '../og-font';
import { CARD } from '../card/tokens';
import { Conversation, Frame, Pills, Rail, Wordmark } from '../card/chrome';

/**
 * Static, so a Satori markup error fails `nx build website` instead of
 * 500ing in public — the lesson recorded in blog/[slug]/opengraph-image.tsx.
 */
export const dynamic = 'force-static';
export const runtime = 'nodejs';

/** GitHub's documented social preview size. */
export const GITHUB_CARD_SIZE = { width: 1280, height: 640 } as const;

const RUNTIMES = POSITIONING_PROOF_POINTS[0].label;
const EYEBROW = 'OPEN SOURCE · ANGULAR';

export const alt = `${PRIMARY_TAGLINE}. ${HERO_SUBHEAD} Beside the copy, a browser frame shows the product pausing for a human: an agent proposes deleting three backups, with Approve and Decline. Works with ${RUNTIMES}.`;

export async function GET() {
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
        {/* 1280x640 is 2.0:1, where the feed card is 1.905:1. Some clients
            crop a 2:1 preview back toward 1.91:1, which takes roughly 12px
            off the top and bottom. The vertical padding absorbs that: the
            extra height over the feed card goes to margin, not to content. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 660,
            padding: '68px 0 68px 72px',
            justifyContent: 'center',
          }}
        >
          <Rail text={EYEBROW} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 22,
              fontFamily: 'Archivo Black, sans-serif',
              fontSize: 62,
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
          {/* The column is centred in a fixed-height card, so copy that runs
              one line long collides with the pills below rather than pushing
              them down. 560 is the widest the 660px column's 72px left
              padding allows and holds the subhead to three lines. */}
          <div style={{ display: 'flex', marginTop: 20, fontSize: 21, lineHeight: 1.45, color: CARD.inkSecondary, maxWidth: 560 }}>
            {HERO_SUBHEAD}
          </div>
          <div style={{ display: 'flex', marginTop: 26 }}>
            <Pills runtimes={RUNTIMES} />
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Wordmark />
          </div>
        </div>

        {/* Absolutely positioned so the frame keeps its size whatever the
            copy does. */}
        <div style={{ display: 'flex', position: 'absolute', top: 152, left: 726 }}>
          <Frame width={490}>
            <Conversation />
          </Frame>
        </div>
      </div>
    ),
    { ...GITHUB_CARD_SIZE, fonts },
  );
}
