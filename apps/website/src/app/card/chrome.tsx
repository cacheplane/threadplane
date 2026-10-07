/**
 * The pieces every social card is built from.
 *
 * Each one mirrors a device the website already uses, so a card and the page
 * it opens read as one product: the rail rule and mono eyebrow from
 * `SectionHeader`, the `BrowserFrame` chrome with its traffic lights and mono
 * URL pill, the `Pill` primitive, and the `LogoMark` wordmark.
 *
 * Satori rule: every element carries an explicit `display`. A div with more
 * than one child and no `display` is rejected at render time, which for the
 * request-time default card would be a 500 on the route.
 */
import { CARD } from './tokens';

export function Rail({ text }: { text: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', height: 3, width: 92, background: CARD.ink, marginBottom: 16 }} />
      <div
        style={{
          display: 'flex',
          fontFamily: 'JetBrains Mono',
          fontSize: 19,
          fontWeight: 700,
          letterSpacing: '0.12em',
          color: CARD.accent,
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** The paper plane, inlined. Kept identical to `public/brand/mark.svg`. */
export function Plane({ size, color = CARD.ink }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M4 34.5 58 6 40 58l-11.5-16.5L36 22 20 37.5z" fill={color} />
    </svg>
  );
}

export function Wordmark({ size = 34, color = CARD.ink }: { size?: number; color?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 13,
        // Archivo Black is a single-weight family, so there is no `fontWeight`
        // here: asking for 700 only sends Satori hunting for a bold that the
        // bundled face does not contain.
        fontFamily: 'Archivo Black',
        fontSize: size,
        color,
      }}
    >
      <Plane size={Math.round(size * 0.88)} color={color} />
      <span>Threadplane</span>
    </div>
  );
}

export function Pills({ runtimes }: { runtimes: string }) {
  return (
    <div style={{ display: 'flex', gap: 12 }}>
      <div
        style={{
          display: 'flex',
          padding: '9px 18px',
          borderRadius: 999,
          background: CARD.accentSurface,
          border: `1px solid ${CARD.accentBorder}`,
          fontFamily: 'JetBrains Mono',
          fontSize: 18,
          fontWeight: 700,
          color: CARD.accent,
        }}
      >
        {runtimes}
      </div>
      <div
        style={{
          display: 'flex',
          padding: '9px 18px',
          borderRadius: 999,
          border: `1px solid ${CARD.borderStrong}`,
          fontFamily: 'JetBrains Mono',
          fontSize: 18,
          fontWeight: 700,
          color: CARD.inkMuted,
        }}
      >
        MIT
      </div>
    </div>
  );
}

export function Frame({
  width,
  url = 'demo.threadplane.ai',
  children,
}: {
  width: number;
  /** Text in the mono address pill. Defaults to the canonical demo host. */
  url?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width,
        borderRadius: 14,
        border: `1px solid ${CARD.border}`,
        background: CARD.canvas,
        overflow: 'hidden',
        boxShadow: '0 22px 48px -20px rgba(0, 0, 0, 0.30)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '13px 18px',
          background: CARD.ground,
          borderBottom: `1px solid ${CARD.border}`,
        }}
      >
        <div style={{ display: 'flex', width: 13, height: 13, borderRadius: 999, background: CARD.trafficRed }} />
        <div style={{ display: 'flex', width: 13, height: 13, borderRadius: 999, background: CARD.trafficAmber }} />
        <div style={{ display: 'flex', width: 13, height: 13, borderRadius: 999, background: CARD.trafficGreen }} />
        <div
          style={{
            display: 'flex',
            marginLeft: 18,
            padding: '5px 16px',
            borderRadius: 6,
            background: CARD.canvas,
            border: `1px solid ${CARD.border}`,
            fontFamily: 'JetBrains Mono',
            fontSize: 16,
            color: CARD.inkMuted,
          }}
        >
          {url}
        </div>
      </div>
      {children}
    </div>
  );
}

/**
 * What the frame holds: one ask, one proposal, one decision.
 *
 * Drawn rather than screenshotted. Every product screenshot we own carries a
 * sidebar, a devtools panel or a table of storage paths, none of which survive
 * feed scale as anything but grey noise — and cropping one only trades the
 * clutter for a fragment. Drawing it means every size here clears
 * MIN_READABLE_PX, and the approval, which is the claim the copy makes, is the
 * one thing the picture shows.
 */
export function Conversation() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '26px 26px 28px', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', padding: '12px 18px', borderRadius: 14, background: CARD.dim, fontSize: 22, color: CARD.ink }}>
          Delete the stale backups.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxWidth: 420 }}>
        <div style={{ display: 'flex', fontSize: 22, lineHeight: 1.45, color: CARD.ink }}>3 backups, 86.5 GB.</div>
        <div style={{ display: 'flex', fontSize: 22, lineHeight: 1.45, color: CARD.ink }}>This cannot be undone.</div>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ display: 'flex', padding: '10px 22px', borderRadius: 10, background: CARD.accent, fontSize: 20, fontWeight: 600, color: '#ffffff' }}>
          Approve
        </div>
        <div style={{ display: 'flex', padding: '10px 22px', borderRadius: 10, background: CARD.canvas, border: `1px solid ${CARD.borderStrong}`, fontSize: 20, fontWeight: 600, color: CARD.inkSecondary }}>
          Decline
        </div>
      </div>
    </div>
  );
}

/**
 * What the AG-UI card's frame holds: one ask, three days the agent filled in.
 *
 * Drawn for the same reason as `Conversation`: the real App-mode screenshot
 * is a map with a side panel, which at feed scale is a grey rectangle. Three
 * short rows read at 0.42x; nothing here is below MIN_READABLE_PX.
 */
export function Itinerary() {
  const days: ReadonlyArray<readonly [string, string]> = [
    ['Day 1', 'Santa Monica Pier at sunset'],
    ['Day 2', 'Griffith Observatory, then tacos'],
    ['Day 3', 'Getty Center, red-eye to JFK'],
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', padding: '26px 26px 28px', gap: 18 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div style={{ display: 'flex', padding: '12px 18px', borderRadius: 14, background: CARD.dim, fontSize: 22, color: CARD.ink }}>
          Plan three days in LA.
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {days.map(([day, plan]) => (
          <div
            key={day}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              padding: '10px 14px',
              borderRadius: 10,
              border: `1px solid ${CARD.border}`,
              background: CARD.canvas,
            }}
          >
            <div style={{ display: 'flex', fontFamily: 'JetBrains Mono', fontSize: 18, fontWeight: 700, color: CARD.accent }}>
              {day}
            </div>
            <div style={{ display: 'flex', fontSize: 20, lineHeight: 1.3, color: CARD.ink }}>{plan}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
