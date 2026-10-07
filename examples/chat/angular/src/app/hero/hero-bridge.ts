export type HeroFrameState = 'ready' | 'scripted' | 'paused' | 'live' | 'replay';
export const HERO_MESSAGE_TYPE = 'tplane-hero';
/** Only these embedders receive frame state or can pause the script. */
export const HERO_PARENT_ORIGINS: readonly string[] = [
  'https://threadplane.ai',
  'https://www.threadplane.ai',
  'http://localhost:3000',
  'http://127.0.0.1:4308',
  // LiveLoveApp's marketing site embeds the hero with `?replay=only`, which
  // keeps the frame on the recorded run (see `isReplayOnly` in hero-mode).
  'https://liveloveapp.com',
  'https://www.liveloveapp.com',
];

/** Preview deployments of the website: `https://<slug>.vercel.app`, one label deep. */
const VERCEL_PREVIEW_ORIGIN = /^https:\/\/[a-z0-9-]+\.vercel\.app$/;

/** True for the website's own origins and for its Vercel preview deployments. */
export function isAllowedParentOrigin(origin: string): boolean {
  return HERO_PARENT_ORIGINS.includes(origin) || VERCEL_PREVIEW_ORIGIN.test(origin);
}

export interface HeroBridge {
  postState(state: HeroFrameState): void;
  onVisibility(cb: (visible: boolean) => void): () => void;
}

interface BridgeEnv {
  referrer: string;
  parent: Window;
  self: Window;
}

function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

export function createHeroBridge(env: BridgeEnv): HeroBridge {
  // The parent origin normally comes from the referrer. Under a strict
  // Referrer-Policy it is empty, so the bridge also learns the origin from the
  // first allowlisted inbound message and replays the latest state to it.
  const fromReferrer = originOf(env.referrer);
  let parentOrigin: string | null =
    fromReferrer !== null && isAllowedParentOrigin(fromReferrer) ? fromReferrer : null;
  let lastState: HeroFrameState | null = null;
  const embedded = env.parent !== env.self;
  if (parentOrigin === null && embedded) {
    console.warn('[hero] parent origin not known from the referrer; waiting for an allowlisted message', fromReferrer);
  }
  const post = (state: HeroFrameState) => {
    if (!embedded || parentOrigin === null) return;
    env.parent.postMessage({ type: HERO_MESSAGE_TYPE, state }, parentOrigin);
  };
  return {
    postState(state) {
      lastState = state;
      post(state);
    },
    onVisibility(cb) {
      const handler = (e: MessageEvent) => {
        if (e.source !== env.parent) return;
        if (!isAllowedParentOrigin(e.origin)) return;
        const d = e.data as { type?: string; visible?: unknown } | null;
        if (!d || d.type !== HERO_MESSAGE_TYPE || typeof d.visible !== 'boolean') return;
        if (parentOrigin === null) {
          parentOrigin = e.origin;
          if (lastState !== null) post(lastState);
        }
        cb(d.visible);
      };
      env.self.addEventListener('message', handler);
      return () => env.self.removeEventListener('message', handler);
    },
  };
}

export function browserHeroBridge(): HeroBridge {
  return createHeroBridge({ referrer: document.referrer, parent: window.parent, self: window });
}
