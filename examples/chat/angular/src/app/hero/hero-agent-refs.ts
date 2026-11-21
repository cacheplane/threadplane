import { createAgentRef } from '@threadplane/angular';
import type { DemoSession } from '../shell/agent-ref';

/** Replay agent: HeroReplayTransport, no backend. */
export const HERO_REPLAY_REF = createAgentRef<DemoSession>('hero-replay');
/** Live agent: the canonical demo's LangGraph backend, fresh thread. */
export const HERO_LIVE_REF = createAgentRef<DemoSession>('hero-live');
