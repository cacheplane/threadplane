/**
 * Social card for a deployed demo, 1200x630.
 *
 * Same ground, rail, pills, wordmark and browser frame as the site's default
 * card in `../opengraph-image.tsx`, so a demo link and a site link unfurl as
 * one product. The frame shows what that demo does: the approval loop for
 * LangGraph, the agent-filled itinerary for AG-UI.
 */
import { ImageResponse } from 'next/og';
import type { DemoMeta } from '../../lib/demo-meta';
import { SOCIAL_CARD_SIZE } from '../../lib/demo-meta';
import { loadCardFonts } from '../og-font';
import { CARD } from './tokens';
import { Conversation, Frame, Itinerary, Pills, Rail, Wordmark } from './chrome';

export async function renderDemoCard(meta: DemoMeta): Promise<ImageResponse> {
  const fonts = await loadCardFonts({ mono: true });
  const host = new URL(meta.origin).host;

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
          <Rail text={meta.cardEyebrow} />
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
            {meta.cardHeadlineLines.map((line) => (
              <div key={line} style={{ display: 'flex' }}>
                {line}
              </div>
            ))}
          </div>
          {/* 530 is the widest the 600px column's 64px padding allows; the
              column is centred in a fixed-height card, so a subhead that runs
              long collides with the pills rather than pushing them down. */}
          <div style={{ display: 'flex', marginTop: 20, fontSize: 20, lineHeight: 1.45, color: CARD.inkSecondary, maxWidth: 530 }}>
            {meta.cardSubhead}
          </div>
          <div style={{ display: 'flex', marginTop: 26 }}>
            <Pills runtimes={meta.runtimeLabel} />
          </div>
          <div style={{ display: 'flex', marginTop: 30 }}>
            <Wordmark />
          </div>
        </div>

        {/* Absolutely positioned so the frame keeps its size whatever the copy does. */}
        <div style={{ display: 'flex', position: 'absolute', top: 150, left: 656 }}>
          <Frame width={480} url={host}>
            {meta.key === 'ag-ui' ? <Itinerary /> : <Conversation />}
          </Frame>
        </div>
      </div>
    ),
    { ...SOCIAL_CARD_SIZE, fonts },
  );
}
