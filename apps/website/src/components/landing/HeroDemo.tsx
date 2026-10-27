'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrowserFrame } from '../ui/BrowserFrame';
import { trackCtaClick } from '../../lib/analytics/client';

export const HERO_DEMO_ORIGIN = 'https://demo.threadplane.ai';
export const HERO_DEMO_URL = `${HERO_DEMO_ORIGIN}/hero`;
export const HERO_POSTER = '/screenshots/hero-walkthrough-poster.webp';
/**
 * The phone-width capture of the same walkthrough beat (585x1359, 65:151). It is
 * a separate render, not a crop: the desktop poster shrunk to a ~348px phone
 * stage is an unreadable smudge, and cropping it slices the right edge off
 * every line of prose. Recorded by
 * `examples/chat/angular/e2e/record-hero-poster-mobile.record.ts`.
 */
export const HERO_POSTER_MOBILE = '/screenshots/hero-walkthrough-poster-mobile.webp';
const POSTER_W = 1200;
const POSTER_H = 720;
const POSTER_MOBILE_W = 585;
const POSTER_MOBILE_H = 1359;
const READY_TIMEOUT_MS = 8000;
/**
 * 0, not 768: phones autoplay too. The poster is a capture displayed at ~0.86
 * scale, but a live iframe lays out at the stage's real width, so its type
 * renders at its designed size — mobile autoplay improves legibility by
 * construction, not just motion. Kept as a named constant so the floor can be
 * restored if the iframe ever costs too much on a phone.
 */
const MIN_AUTOPLAY_WIDTH = 0;
/**
 * Kept in lockstep with the `@media (max-width: 767px)` block in landing.css
 * that gives `.hero-demo-stage` its 65:151 portrait ratio. This pair is coupled
 * to the PHONE POSTER'S GEOMETRY (390x906, shipped 585x1359) — the poster is
 * served exactly where the stage is portrait, so `object-fit: cover` crops
 * nothing. The height is MEASURED from the replay's own block boundaries, not
 * chosen: 906 frames the whole streamed backup table, and because this ratio
 * also sizes the LIVE iframe below 768px it gives the phone demo more viewport
 * than the earlier 3:5 and 195:263 budgets did. See that recorder's header.
 *
 * It used to be a triple including MIN_AUTOPLAY_WIDTH, which is no longer part
 * of it: autoplay is now width-independent and this breakpoint no longer has
 * anything to do with whether the iframe mounts.
 */
export const HERO_POSTER_MOBILE_MEDIA = '(max-width: 767px)';
const MESSAGE_TYPE = 'tplane-hero';

type State = 'poster' | 'playRequested' | 'mounting' | 'ready' | 'fallback';

function autoplayAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.innerWidth < MIN_AUTOPLAY_WIDTH) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Hero demo: server-rendered poster (the LCP), iframe mounted after hydration
 * when the hero is visible on a motion-tolerant viewport, crossfaded in
 * when the frame reports ready.
 */
export function HeroDemo() {
  const [state, setState] = useState<State>('poster');
  const [visible, setVisible] = useState(false);
  const [needsClick, setNeedsClick] = useState(false);
  /**
   * True once the frame's window has actually navigated to the demo origin —
   * proven by the iframe's `load` event, or by the frame having spoken to us.
   * A freshly created iframe's `contentWindow` is still `about:blank`, and
   * posting to it with the demo's target origin is silently dropped (and logs
   * "the target origin ... does not match the recipient window's origin"), so
   * the visibility handshake must not start before this flips.
   */
  const [frameLoaded, setFrameLoaded] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const lastFrameState = useRef<string | null>(null);
  /** Read by the message handler, which is registered once and never re-bound. */
  const visibleRef = useRef(false);

  // Visibility.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver((entries) => setVisible(entries.some((e) => e.isIntersecting)), {
      threshold: 0.25,
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Decide whether to mount.
  useEffect(() => {
    if (!visible) return;
    if (state !== 'poster' && state !== 'playRequested') return;
    if (state === 'playRequested' || autoplayAllowed()) setState('mounting');
    else setNeedsClick(true);
  }, [visible, state]);

  // Ready timeout → fallback.
  useEffect(() => {
    if (state !== 'mounting') return;
    const t = setTimeout(() => setState((s) => (s === 'mounting' ? 'fallback' : s)), READY_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [state]);

  const postVisibility = useCallback((v: boolean) => {
    iframeRef.current?.contentWindow?.postMessage({ type: MESSAGE_TYPE, visible: v }, HERO_DEMO_ORIGIN);
  }, []);

  // Frame → website messages.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== HERO_DEMO_ORIGIN) return;
      const d = e.data as { type?: string; state?: string } | null;
      if (!d || d.type !== MESSAGE_TYPE || typeof d.state !== 'string') return;
      // The frame spoke, so its window has navigated — safe to post to even if
      // we somehow never saw the iframe's own load event.
      setFrameLoaded(true);
      if (d.state === 'ready') {
        setState((s) => (s === 'mounting' || s === 'fallback' ? 'ready' : s));
        // Answer EVERY `ready`, not just the first. The frame re-announces
        // `ready` until it has heard a visibility message, so this ack is what
        // recovers the handshake when our first post was lost — otherwise the
        // frame sits on its empty welcome state and never starts.
        postVisibility(visibleRef.current);
      }
      if (d.state === lastFrameState.current) return;
      lastFrameState.current = d.state;
      if (d.state === 'live') trackCtaClick({ cta_id: 'hero_demo_takeover', track: 'developer', surface: 'home' });
      if (d.state === 'replay') trackCtaClick({ cta_id: 'hero_demo_replay', track: 'developer', surface: 'home' });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postVisibility]);

  const mounted = state === 'mounting' || state === 'ready' || state === 'fallback';

  // Website → frame visibility. Posted whenever the iframe is mounted AND has
  // navigated — while mounting, once ready, and after the ready timeout has
  // already dropped us into `fallback` — so a frame whose referrer was
  // stripped can learn our origin from this message and replay its `ready`
  // state to us late.
  useEffect(() => {
    visibleRef.current = visible;
    if (!mounted || !frameLoaded) return;
    postVisibility(visible);
  }, [visible, mounted, frameLoaded, postVisibility]);

  const play = useCallback(() => {
    trackCtaClick({ cta_id: 'hero_demo_play', track: 'developer', surface: 'home' });
    setNeedsClick(false);
    setState('playRequested');
  }, []);

  return (
    <div ref={rootRef} className="hero-demo" data-hero-demo data-state={state}>
      <BrowserFrame url="demo.threadplane.ai/hero" elevation="lg" className="hero-demo-frame">
        <div className="hero-demo-stage">
          {/*
            A <picture> rather than srcset/sizes: the two posters are different
            renders of the same moment at different aspect ratios, so the choice
            is art direction — the browser must pick by viewport, not by device
            pixel ratio. The <img> keeps every LCP attribute; the stage's own
            aspect-ratio (not these intrinsic dimensions) sizes the box, so the
            source swap can shift nothing.
          */}
          <picture>
            <source
              media={HERO_POSTER_MOBILE_MEDIA}
              srcSet={HERO_POSTER_MOBILE}
              width={POSTER_MOBILE_W}
              height={POSTER_MOBILE_H}
            />
            <img
              src={HERO_POSTER}
              width={POSTER_W}
              height={POSTER_H}
              alt="Threadplane chat replaying a recorded LangGraph run: a user prompt, a request_approval tool call, and the streamed three-step cleanup plan"
              className="hero-demo-poster"
              loading="eager"
              decoding="async"
              // React 19 lowercases this attribute; the spec asserts the DOM value.
              fetchPriority="high"
            />
          </picture>
          {mounted ? (
            <iframe
              ref={iframeRef}
              src={HERO_DEMO_URL}
              title="Threadplane live demo"
              className="hero-demo-iframe"
              allow="clipboard-write"
              onLoad={() => setFrameLoaded(true)}
            />
          ) : null}
          {needsClick && !mounted ? (
            <button type="button" className="hero-demo-play" onClick={play}>
              Play walkthrough
            </button>
          ) : null}
          {state === 'fallback' ? (
            <a
              className="hero-demo-fallback"
              href={HERO_DEMO_ORIGIN}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                trackCtaClick({ cta_id: 'hero_demo_fallback_open', track: 'developer', surface: 'home' })
              }
            >
              Open the live demo →
            </a>
          ) : null}
        </div>
      </BrowserFrame>
    </div>
  );
}
