// @vitest-environment jsdom
import React, { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const trackCtaClickMock = vi.hoisted(() => vi.fn());
vi.mock('../../lib/analytics/client', () => ({ trackCtaClick: trackCtaClickMock, track: vi.fn() }));
vi.mock('../ui/BrowserFrame', () => ({
  BrowserFrame: ({ children }: { children: React.ReactNode }) => <div data-frame>{children}</div>,
}));

type IOCallback = (entries: { isIntersecting: boolean }[]) => void;
let ioCallback: IOCallback | null = null;

function installEnv({ width = 1280, reduced = false }: { width?: number; reduced?: boolean } = {}) {
  Object.defineProperty(window, 'innerWidth', { value: width, configurable: true });
  window.matchMedia = vi.fn().mockImplementation((q: string) => ({
    matches: q.includes('reduce') ? reduced : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    media: q,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
  class IO {
    constructor(cb: IOCallback) {
      ioCallback = cb;
    }
    observe() {
      /* the test drives the callback directly */
    }
    unobserve() {
      /* no-op */
    }
    disconnect() {
      /* no-op */
    }
  }
  (window as unknown as { IntersectionObserver: unknown }).IntersectionObserver = IO;
}

function frameReady(origin = 'https://demo.threadplane.ai') {
  fireEvent(window, new MessageEvent('message', { origin, data: { type: 'tplane-hero', state: 'ready' } }));
}

/** Replace the jsdom iframe's `contentWindow` with a spy we can assert on. */
function stubContentWindow(iframe: HTMLIFrameElement) {
  const postMessage = vi.fn();
  Object.defineProperty(iframe, 'contentWindow', { value: { postMessage }, configurable: true });
  return postMessage;
}

beforeEach(() => {
  vi.useFakeTimers();
  ioCallback = null;
  trackCtaClickMock.mockClear();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('HeroDemo', () => {
  it('server-renders the poster eagerly with explicit dimensions and no iframe', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/screenshots/hero-walkthrough-poster.webp');
    expect(img.getAttribute('width')).toBe('1200');
    expect(img.getAttribute('height')).toBe('720');
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('alt')).toBe(
      'Threadplane chat replaying a recorded LangGraph run: a user prompt, a request_approval tool call, and the streamed three-step cleanup plan',
    );
    expect(container.querySelector('iframe')).toBeNull();
  });

  /**
   * The desktop poster shrunk into a ~348px phone stage is an unreadable
   * smudge, so a phone gets its own capture. Both sources have to reach the
   * markup, the <source> has to precede the <img> (a <picture> takes the FIRST
   * matching source, and an <img> that came first would win every time), and
   * the media query has to stay on the same 768px boundary as the stage's
   * portrait ratio in landing.css. Those two are the whole coupling, and both
   * are tied to the phone poster's 390x906 geometry: the poster is served
   * exactly where the stage is portrait, so `object-fit: cover` crops nothing.
   * MIN_AUTOPLAY_WIDTH used to be a third leg and is not one any more —
   * autoplay is width-independent and this boundary says nothing about it.
   */
  it('offers a phone-width poster source ahead of the desktop img', async () => {
    installEnv();
    const { HeroDemo, HERO_POSTER, HERO_POSTER_MOBILE, HERO_POSTER_MOBILE_MEDIA } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    const picture = container.querySelector('picture') as HTMLElement;
    expect(picture).toBeTruthy();
    const source = picture.querySelector('source') as HTMLSourceElement;
    expect(source.getAttribute('srcset')).toBe(HERO_POSTER_MOBILE);
    expect(HERO_POSTER_MOBILE).not.toBe(HERO_POSTER);
    expect(source.getAttribute('media')).toBe('(max-width: 767px)');
    expect(HERO_POSTER_MOBILE_MEDIA).toBe('(max-width: 767px)');
    // 585x1359 — the 65:151 phone capture (390x906 at the 1.5x ship scale), so
    // `object-fit: cover` crops nothing. Moves with the recorder's viewport and
    // the `.hero-demo-stage` ratio in landing.css; see that recorder's header
    // for how 906 is measured from the replay's own block boundaries.
    expect(source.getAttribute('width')).toBe('585');
    expect(source.getAttribute('height')).toBe('1359');
    expect([...picture.children].map((el) => el.tagName)).toEqual(['SOURCE', 'IMG']);
  });

  /**
   * Both posters are recorded artifacts, not build output, so a rename or a
   * lost file would ship a hero with a broken image and nothing would fail
   * until someone looked at the page.
   *
   * The phone poster's budget is ABSOLUTE, not a comparison against the desktop
   * poster. It was written as `mobile <= desktop` first, on the reasoning that a
   * phone downloads one instead of the other, and that coupling was wrong: both
   * files are re-recorded together, so re-recording the walkthrough shrank the
   * desktop capture 38.1KB -> 33.0KB and failed the phone poster for content it
   * does not contain. The phone poster is not justified on bytes anyway. Below
   * 768px `.hero-demo-stage` is `aspect-ratio: 65 / 151` with `object-fit:
   * cover`, so the 1200x720 desktop capture covering that portrait box shows
   * about 26% of its own width — the phone poster exists because that crop is
   * unusable, and it would still be worth shipping if it cost slightly more.
   *
   * The ceiling is what the recorder actually budgeted against when it chose to
   * ship 1.5x rather than 2x ("2x would cost ~51KB"): the mid-30s KB. Raise it
   * only with a reason, and never by simply pasting in whatever the file now
   * weighs — the point is to notice a poster that got expensive.
   */
  const HERO_POSTER_MOBILE_MAX_BYTES = 36_000;

  it('ships both posters, with the phone one inside its byte budget', async () => {
    const { HERO_POSTER, HERO_POSTER_MOBILE } = await import('./HeroDemo');
    const { resolveWebsiteDir } = await import('../../lib/website-dir');
    const { statSync } = await import('node:fs');
    const { join } = await import('node:path');
    const sizeOf = (publicPath: string) =>
      statSync(join(resolveWebsiteDir(), 'public', publicPath)).size;
    expect(sizeOf(HERO_POSTER)).toBeGreaterThan(0);
    expect(sizeOf(HERO_POSTER_MOBILE)).toBeGreaterThan(0);
    expect(sizeOf(HERO_POSTER_MOBILE)).toBeLessThanOrEqual(HERO_POSTER_MOBILE_MAX_BYTES);
  });

  /**
   * The poster is the LCP element on every viewport. Wrapping it in a
   * <picture> must not cost it its priority hints or its class, or the swap
   * buys legibility and pays for it in load time.
   */
  it('keeps the poster eager and high priority inside the picture', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    const img = container.querySelector('picture > img') as HTMLImageElement;
    expect(img.getAttribute('loading')).toBe('eager');
    expect(img.getAttribute('fetchpriority')).toBe('high');
    expect(img.getAttribute('decoding')).toBe('async');
    expect(img.className).toBe('hero-demo-poster');
  });

  it('mounts the iframe when visible on desktop and reveals it on ready from the demo origin', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe.getAttribute('src')).toBe('https://demo.threadplane.ai/hero');
    expect(iframe.getAttribute('title')).toBe('Threadplane live demo');
    expect(container.querySelector('[data-hero-demo]')?.getAttribute('data-state')).toBe('mounting');
    act(() => {
      frameReady();
    });
    expect(container.querySelector('[data-hero-demo]')?.getAttribute('data-state')).toBe('ready');
  });

  it('posts visible: true to the demo origin when the iframe loads', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const post = stubContentWindow(iframe);
    act(() => {
      fireEvent.load(iframe);
    });
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: true }, 'https://demo.threadplane.ai');
  });

  /**
   * A freshly created iframe's contentWindow is still `about:blank`, so posting
   * with the demo's target origin is dropped and logs a console error on every
   * single load. Nothing may be posted before the frame has navigated.
   */
  it('posts nothing to the frame before it has navigated', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const post = stubContentWindow(iframe);
    act(() => {
      ioCallback?.([{ isIntersecting: false }]);
    });
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    expect(post).not.toHaveBeenCalled();
    // Guards the assertion above against passing vacuously on a dead spy.
    act(() => {
      fireEvent.load(iframe);
    });
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: true }, 'https://demo.threadplane.ai');
  });

  /**
   * The frame re-announces `ready` until it hears a visibility message, so the
   * parent must answer EVERY announcement — that ack is what recovers the
   * handshake when the first post was lost.
   */
  it('re-posts the current visibility on every ready announcement', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const post = stubContentWindow(container.querySelector('iframe') as HTMLIFrameElement);
    act(() => {
      frameReady();
    });
    // A `ready` proves the frame navigated, so the ack lands with no load event.
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: true }, 'https://demo.threadplane.ai');

    post.mockClear();
    act(() => {
      frameReady();
    });
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: true }, 'https://demo.threadplane.ai');
  });

  it('ignores ready from a foreign origin and falls back after the timeout', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    act(() => {
      frameReady('https://evil.example');
    });
    expect(container.querySelector('[data-hero-demo]')?.getAttribute('data-state')).toBe('mounting');
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(container.querySelector('[data-hero-demo]')?.getAttribute('data-state')).toBe('fallback');
    expect(screen.getByRole('link', { name: /Open the live demo/ }).getAttribute('href')).toBe(
      'https://demo.threadplane.ai',
    );
  });

  it('keeps posting visibility to the frame after the ready timeout drops it into fallback', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const post = stubContentWindow(iframe);
    act(() => {
      fireEvent.load(iframe);
    });
    act(() => {
      vi.advanceTimersByTime(8000);
    });
    expect(container.querySelector('[data-hero-demo]')?.getAttribute('data-state')).toBe('fallback');
    post.mockClear();
    act(() => {
      ioCallback?.([{ isIntersecting: false }]);
    });
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: true }, 'https://demo.threadplane.ai');
  });

  /**
   * Reduced motion is the ONLY thing that still holds the iframe back, and a
   * phone is where it matters most — the stage is portrait and the replay
   * fills it.
   * The suite's other reduced-motion test runs at the default 1280, so without
   * this one nothing covers reduce at phone width.
   */
  it('shows Play walkthrough under reduced motion at phone width, and mounts on click', async () => {
    installEnv({ width: 390, reduced: true });
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    expect(container.querySelector('iframe')).toBeNull();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
    });
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(trackCtaClickMock).toHaveBeenCalledWith(expect.objectContaining({ cta_id: 'hero_demo_play' }));
  });

  /**
   * The change this guards: MIN_AUTOPLAY_WIDTH is 0, so a phone autoplays. The
   * poster is a capture displayed at ~0.86 scale while a live iframe lays out
   * at the stage's real width, so mobile autoplay is a legibility win, not just
   * motion. Restoring any width floor would fail here.
   */
  it('autoplays the iframe at phone width when motion is allowed', async () => {
    installEnv({ width: 390 });
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    expect(container.querySelector('iframe')).toBeNull();
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    expect(container.querySelector('iframe')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Play walkthrough' })).toBeNull();
  });

  it('shows Play walkthrough under reduced motion', async () => {
    installEnv({ reduced: true });
    const { HeroDemo } = await import('./HeroDemo');
    render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    expect(screen.getByRole('button', { name: 'Play walkthrough' })).toBeTruthy();
  });

  it('tracks takeover and replay once per frame state message', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    act(() => {
      frameReady();
    });
    act(() => {
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'https://demo.threadplane.ai',
          data: { type: 'tplane-hero', state: 'live' },
        }),
      );
    });
    act(() => {
      fireEvent(
        window,
        new MessageEvent('message', {
          origin: 'https://demo.threadplane.ai',
          data: { type: 'tplane-hero', state: 'replay' },
        }),
      );
    });
    expect(trackCtaClickMock).toHaveBeenCalledWith(expect.objectContaining({ cta_id: 'hero_demo_takeover' }));
    expect(trackCtaClickMock).toHaveBeenCalledWith(expect.objectContaining({ cta_id: 'hero_demo_replay' }));
  });

  it('forwards visibility to the frame with the demo origin', async () => {
    installEnv();
    const { HeroDemo } = await import('./HeroDemo');
    const { container } = render(<HeroDemo />);
    act(() => {
      ioCallback?.([{ isIntersecting: true }]);
    });
    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    const post = stubContentWindow(iframe);
    act(() => {
      frameReady();
    });
    act(() => {
      ioCallback?.([{ isIntersecting: false }]);
    });
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', visible: false }, 'https://demo.threadplane.ai');
  });
});
