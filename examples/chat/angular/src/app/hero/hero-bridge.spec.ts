import { describe, expect, it, vi } from 'vitest';
import { HERO_PARENT_ORIGINS, createHeroBridge, isAllowedParentOrigin } from './hero-bridge';

describe('createHeroBridge', () => {
  it('posts state to the parent when the referrer origin is allowlisted', () => {
    const post = vi.fn();
    const b = createHeroBridge({
      referrer: 'https://threadplane.ai/',
      parent: { postMessage: post } as unknown as Window,
      self: {} as Window,
    });
    b.postState('ready');
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', state: 'ready' }, 'https://threadplane.ai');
  });
  it('posts state to a Vercel preview deployment of the website', () => {
    const post = vi.fn();
    const b = createHeroBridge({
      referrer: 'https://website-git-branch-acme.vercel.app/hero',
      parent: { postMessage: post } as unknown as Window,
      self: {} as Window,
    });
    b.postState('ready');
    expect(post).toHaveBeenCalledWith(
      { type: 'tplane-hero', state: 'ready' },
      'https://website-git-branch-acme.vercel.app',
    );
  });
  it('does not post when the referrer is not allowlisted', () => {
    const post = vi.fn();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => void 0);
    const b = createHeroBridge({
      referrer: 'https://evil.example/',
      parent: { postMessage: post } as unknown as Window,
      self: {} as Window,
    });
    b.postState('ready');
    expect(post).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
  it('delivers visibility only from an allowlisted origin and the parent frame', () => {
    const listeners: ((e: MessageEvent) => void)[] = [];
    const self = {
      addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.push(l),
      removeEventListener: vi.fn(),
    } as unknown as Window;
    const parent = { postMessage: vi.fn() } as unknown as Window;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => void 0);
    const b = createHeroBridge({ referrer: '', parent, self });
    const seen: boolean[] = [];
    b.onVisibility((v) => seen.push(v));
    listeners[0]({
      origin: 'https://threadplane.ai',
      source: parent,
      data: { type: 'tplane-hero', visible: true },
    } as unknown as MessageEvent);
    listeners[0]({
      origin: 'https://evil.example',
      source: parent,
      data: { type: 'tplane-hero', visible: false },
    } as unknown as MessageEvent);
    listeners[0]({
      origin: 'http://localhost:3000',
      source: parent,
      data: { type: 'other' },
    } as unknown as MessageEvent);
    listeners[0]({
      origin: 'https://threadplane.ai',
      source: {} as Window,
      data: { type: 'tplane-hero', visible: false },
    } as unknown as MessageEvent);
    expect(seen).toEqual([true]);
    warn.mockRestore();
  });
  it('allowlist contains the production and local website origins', () => {
    expect(HERO_PARENT_ORIGINS).toContain('https://threadplane.ai');
    expect(HERO_PARENT_ORIGINS).toContain('https://www.threadplane.ai');
    expect(HERO_PARENT_ORIGINS).toContain('http://localhost:3000');
    expect(HERO_PARENT_ORIGINS).toContain('http://127.0.0.1:4308');
    expect(HERO_PARENT_ORIGINS).toContain('https://liveloveapp.com');
    expect(HERO_PARENT_ORIGINS).toContain('https://www.liveloveapp.com');
  });
});

describe('isAllowedParentOrigin', () => {
  it('accepts allowlisted and Vercel preview origins', () => {
    expect(isAllowedParentOrigin('https://threadplane.ai')).toBe(true);
    expect(isAllowedParentOrigin('https://website-abc123.vercel.app')).toBe(true);
    expect(isAllowedParentOrigin('https://liveloveapp.com')).toBe(true);
    expect(isAllowedParentOrigin('https://www.liveloveapp.com')).toBe(true);
  });
  it('rejects look-alike and non-preview origins', () => {
    expect(isAllowedParentOrigin('https://evil.vercel.app.example')).toBe(false);
    expect(isAllowedParentOrigin('http://foo.vercel.app')).toBe(false);
    expect(isAllowedParentOrigin('https://sub.foo.vercel.app')).toBe(false);
    expect(isAllowedParentOrigin('https://evil.example')).toBe(false);
    expect(isAllowedParentOrigin('http://liveloveapp.com')).toBe(false);
    expect(isAllowedParentOrigin('https://liveloveapp.com.evil.example')).toBe(false);
  });
  it('learns the parent origin from the first allowlisted message when the referrer is empty, and replays the last state', () => {
    const post = vi.fn();
    const parent = { postMessage: post } as unknown as Window;
    const listeners: ((e: MessageEvent) => void)[] = [];
    const self = { addEventListener: (_: string, l: (e: MessageEvent) => void) => listeners.push(l), removeEventListener: vi.fn() } as unknown as Window;
    const b = createHeroBridge({ referrer: '', parent, self });
    b.postState('ready');
    expect(post).not.toHaveBeenCalled();
    const seen: boolean[] = [];
    b.onVisibility((v) => seen.push(v));
    listeners[0]({ origin: 'https://threadplane.ai', source: parent, data: { type: 'tplane-hero', visible: true } } as unknown as MessageEvent);
    expect(post).toHaveBeenCalledWith({ type: 'tplane-hero', state: 'ready' }, 'https://threadplane.ai');
    expect(seen).toEqual([true]);
    b.postState('scripted');
    expect(post).toHaveBeenLastCalledWith({ type: 'tplane-hero', state: 'scripted' }, 'https://threadplane.ai');
  });
});
