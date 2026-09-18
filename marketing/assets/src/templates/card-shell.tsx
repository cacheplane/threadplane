import { brand } from '../brand';
import type { CardInput } from '../types';

/**
 * The shared card body, in the website card kit's chrome.
 *
 * Mirrors `apps/website/src/app/card/chrome.tsx` device for device: the rail
 * rule and mono eyebrow from `SectionHeader`, the `Pill` primitive, and the
 * `LogoMark` wordmark with the mark inlined as SVG.
 *
 * Satori rule, same as the kit: every element carries an explicit `display`.
 * A div with more than one child and no `display` is rejected at render time.
 */
interface CardShellProps {
  input: CardInput;
  headlineSize: number;
  padding: string;
}

interface PillProps {
  tone: 'accent' | 'neutral' | 'angular';
  children: string;
}

/** The paper plane, inlined. Copied from the kit's `Plane`, which is kept
 * identical to `apps/website/public/brand/mark.svg`. Satori renders inline
 * SVG, which is why there is no bundled PNG any more. */
function Plane({ size, color = brand.ink }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <path d="M4 34.5 58 6 40 58l-11.5-16.5L36 22 20 37.5z" fill={color} />
    </svg>
  );
}

function PillBadge({ tone, children }: PillProps) {
  const styles = {
    accent: { bg: brand.accentSurface, border: brand.accentBorder, color: brand.accent },
    // The kit's neutral pill: strong border, muted ink, no fill.
    neutral: { bg: 'transparent', border: brand.borderStrong, color: brand.inkMuted },
    // `#DD0031` is a real design token (`--color-angular-red`), so this pill
    // keeps its red — restated in the kit's accent-pill idiom (tinted fill,
    // tinted border, coloured text) rather than in its own.
    angular: {
      bg: 'rgba(221, 0, 49, 0.06)',
      border: 'rgba(221, 0, 49, 0.28)',
      color: brand.angular,
    },
  }[tone];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '9px 18px',
        borderRadius: 999,
        background: styles.bg,
        border: `1px solid ${styles.border}`,
        color: styles.color,
        fontFamily: brand.mono,
        fontSize: 18,
        fontWeight: 700,
      }}
    >
      {children}
    </div>
  );
}

export function CardShell({ input, headlineSize, padding }: CardShellProps) {
  const eyebrow = input.eyebrow ?? brand.defaultEyebrow;
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        background: brand.ground,
        display: 'flex',
        flexDirection: 'column',
        padding,
        color: brand.ink,
        fontFamily: brand.sans,
      }}
    >
      {/* Rail + eyebrow, the kit's `Rail` */}
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 28 }}>
        <div
          style={{
            display: 'flex',
            height: 3,
            width: 92,
            background: brand.ink,
            marginBottom: 16,
          }}
        />
        <div
          style={{
            display: 'flex',
            fontFamily: brand.mono,
            fontSize: 19,
            fontWeight: 700,
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
            color: brand.accent,
          }}
        >
          {eyebrow}
        </div>
      </div>

      {/* Headline */}
      <div
        style={{
          display: 'flex',
          // No `fontWeight`: Archivo Black is a single-weight family.
          fontFamily: brand.display,
          fontSize: headlineSize,
          lineHeight: 1.05,
          letterSpacing: '-0.02em',
          color: brand.ink,
          marginBottom: 24,
          maxWidth: 980,
        }}
      >
        {input.title}
      </div>

      {/* Subtitle */}
      {input.subtitle ? (
        <div
          style={{
            display: 'flex',
            fontSize: 26,
            lineHeight: 1.45,
            color: brand.inkSecondary,
            maxWidth: 920,
            marginBottom: 'auto',
          }}
        >
          {input.subtitle}
        </div>
      ) : (
        <div style={{ display: 'flex', marginBottom: 'auto' }} />
      )}

      {/* Footer */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 36,
        }}
      >
        {input.author ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 22 }}>
            <span style={{ fontWeight: 600, color: brand.ink }}>{input.author.name}</span>
            {input.author.role ? (
              <span style={{ color: brand.inkMuted }}>{`· ${input.author.role}`}</span>
            ) : null}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 12 }}>
            <PillBadge tone="accent">MIT</PillBadge>
            <PillBadge tone="neutral">LangGraph + AG-UI</PillBadge>
            <PillBadge tone="angular">Angular 20+</PillBadge>
          </div>
        )}
        {/* Wordmark, the kit's `Wordmark` */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 13,
            fontFamily: brand.display,
            fontSize: 30,
            color: brand.ink,
          }}
        >
          <Plane size={26} color={brand.ink} />
          <span>{brand.wordmark}</span>
        </div>
      </div>
    </div>
  );
}
