// libs/chat/src/lib/styles/chat-tokens.spec.ts
import { describe, expect, it } from 'vitest';
import { REDUCED_MOTION_LOOP_SELECTORS, ROOT_TOKEN_STYLES } from './chat-tokens';
import { componentStyleSources } from './style-contract';

describe('ROOT_TOKEN_STYLES — prefers-reduced-motion', () => {
  it('includes a prefers-reduced-motion media block', () => {
    expect(ROOT_TOKEN_STYLES).toContain('@media (prefers-reduced-motion: reduce)');
  });

  it('applies a universal selector inside the media block', () => {
    expect(ROOT_TOKEN_STYLES).toMatch(/\*,\s*\*::before,\s*\*::after/);
  });

  it('collapses animation-duration to 0.01ms', () => {
    expect(ROOT_TOKEN_STYLES).toContain('animation-duration: 0.01ms');
  });

  it('collapses transition-duration to 0.01ms', () => {
    expect(ROOT_TOKEN_STYLES).toContain('transition-duration: 0.01ms');
  });

  it('caps animation-iteration-count to 1', () => {
    expect(ROOT_TOKEN_STYLES).toContain('animation-iteration-count: 1');
  });

  it('forces auto scroll-behavior', () => {
    expect(ROOT_TOKEN_STYLES).toContain('scroll-behavior: auto');
  });

  it.each([...REDUCED_MOTION_LOOP_SELECTORS])(
    'stops the looping animation on %s',
    (selector) => {
      const block = reducedMotionLoopBlock();
      expect(block.selectors).toContain(selector);
      expect(block.body).toMatch(/animation:\s*none\s*!important/);
    },
  );

  it('covers every infinite animation the chat components render', () => {
    const targets = loopingAnimationTargets();
    // Guard the scan itself: a broken walk would make the check vacuous.
    expect(targets.map(({ target }) => target)).toEqual(
      expect.arrayContaining(['.chat-typing__dot', '.chat-message__caret', '.chat-reasoning__pulse']),
    );
    const uncovered = targets.filter(({ target }) =>
      !REDUCED_MOTION_LOOP_SELECTORS.some((selector) => selector.endsWith(target)),
    );
    expect(uncovered).toEqual([]);
  });

  it('names only classes that exist in component styles', () => {
    const sources = componentStyleSources().map(({ source }) => source).join('\n');
    const missing = REDUCED_MOTION_LOOP_SELECTORS.flatMap((selector) =>
      [...selector.matchAll(/\.([A-Za-z][\w-]*)/g)].map((match) => match[1]),
    ).filter((className) => !new RegExp(`\\.${className}(?![\\w-])`).test(sources));
    expect(missing).toEqual([]);
  });

  it.each([
    '.tplane-chat-typing-dot',
    '.tplane-chat-caret',
    '.tplane-chat-welcome__pulse',
  ])('does not target the nonexistent class %s', (selector) => {
    expect(ROOT_TOKEN_STYLES).not.toContain(selector);
  });
});

/**
 * Finds each CSS rule whose `animation` loops forever and returns the
 * element it animates: the rule's selector with any `:host(...)` prefix
 * removed (Angular rewrites that to the host attribute, which a global
 * stylesheet cannot name).
 */
function loopingAnimationTargets(): { file: string; target: string }[] {
  const out: { file: string; target: string }[] = [];
  for (const { file, source } of componentStyleSources()) {
    for (const match of source.matchAll(/animation:[^;]*\binfinite\b/g)) {
      const open = source.lastIndexOf('{', match.index);
      const start = Math.max(
        source.lastIndexOf('}', open),
        source.lastIndexOf('`', open),
        source.lastIndexOf(';', open),
      );
      const selectorList = source.slice(start + 1, open);
      for (const raw of selectorList.split(',')) {
        const target = raw.trim().replace(/^:host(\([^)]*\))?\s*/, '');
        out.push({ file, target });
      }
    }
  }
  return out;
}

function reducedMotionLoopBlock(): { selectors: string[]; body: string } {
  const media = ROOT_TOKEN_STYLES.slice(
    ROOT_TOKEN_STYLES.indexOf('@media (prefers-reduced-motion: reduce)'),
  );
  const first = REDUCED_MOTION_LOOP_SELECTORS[0];
  const start = media.indexOf(first);
  const open = media.indexOf('{', start);
  const close = media.indexOf('}', open);
  return {
    selectors: media.slice(start, open).split(',').map((selector) => selector.trim()),
    body: media.slice(open + 1, close),
  };
}

describe('ROOT_TOKEN_STYLES — edge-claim primitive', () => {
  it.each([
    '--tplane-chat-occupy-top:    0px;',
    '--tplane-chat-occupy-right:  0px;',
    '--tplane-chat-occupy-bottom: 0px;',
    '--tplane-chat-occupy-left:   0px;',
  ])('defines default %s on :root', (decl) => {
    expect(ROOT_TOKEN_STYLES).toContain(decl);
  });

  it.each([
    '--tplane-chat-debug-panel-size-h: 40vh;',
    '--tplane-chat-debug-panel-size-w: 420px;',
  ])('defines debug panel size token %s', (decl) => {
    expect(ROOT_TOKEN_STYLES).toContain(decl);
  });

  it('maps data-threadplane-chat-sidebar="open" to occupy-right', () => {
    expect(ROOT_TOKEN_STYLES).toMatch(
      /:root\[data-threadplane-chat-sidebar="open"\]\s*\{[^}]*--tplane-chat-occupy-right:\s*var\(--tplane-chat-sidebar-width-drawer/,
    );
  });

  it.each([
    ['bottom', '--tplane-chat-occupy-bottom', '--tplane-chat-debug-panel-size-h'],
    ['right',  '--tplane-chat-occupy-right',  '--tplane-chat-debug-panel-size-w'],
    ['left',   '--tplane-chat-occupy-left',   '--tplane-chat-debug-panel-size-w'],
  ])('maps data-threadplane-chat-debug=%s to %s via %s', (dock, occupyVar, sizeVar) => {
    const pattern = new RegExp(
      `:root\\[data-threadplane-chat-debug="${dock}"\\]\\s*\\{[^}]*${occupyVar}:\\s*var\\(${sizeVar}`,
    );
    expect(ROOT_TOKEN_STYLES).toMatch(pattern);
  });

  // ── per-component claim vars (peer-only reads) ────────────────────────
  // Components must NOT read their own aggregate claim (would feedback).
  // Each component publishes a per-component claim var that peers read.
  it.each([
    '--tplane-chat-sidebar-claim-right:  0px;',
    '--tplane-chat-debug-claim-top:      0px;',
    '--tplane-chat-debug-claim-right:    0px;',
    '--tplane-chat-debug-claim-bottom:   0px;',
    '--tplane-chat-debug-claim-left:     0px;',
  ])('defines per-component default %s', (decl) => {
    expect(ROOT_TOKEN_STYLES).toContain(decl);
  });

  it('sidebar attribute mapping also sets per-component claim var', () => {
    expect(ROOT_TOKEN_STYLES).toMatch(
      /:root\[data-threadplane-chat-sidebar="open"\]\s*\{[^}]*--tplane-chat-sidebar-claim-right:\s*var\(--tplane-chat-sidebar-width-drawer/,
    );
  });

  it.each([
    ['bottom', '--tplane-chat-debug-claim-bottom', '--tplane-chat-debug-panel-size-h'],
    ['right',  '--tplane-chat-debug-claim-right',  '--tplane-chat-debug-panel-size-w'],
    ['left',   '--tplane-chat-debug-claim-left',   '--tplane-chat-debug-panel-size-w'],
  ])('debug attribute mapping for %s also sets %s', (dock, claimVar, sizeVar) => {
    const pattern = new RegExp(
      `:root\\[data-threadplane-chat-debug="${dock}"\\]\\s*\\{[^}]*${claimVar}:\\s*var\\(${sizeVar}`,
    );
    expect(ROOT_TOKEN_STYLES).toMatch(pattern);
  });
});

describe('ROOT_TOKEN_STYLES — citation tokens', () => {
  it.each([
    '--tplane-chat-citation-accent:',
    '--tplane-chat-citation-accent-soft:',
    '--tplane-chat-citation-accent-border:',
    '--tplane-chat-citation-marker-bg:',
    '--tplane-chat-citation-marker-border:',
    '--tplane-chat-citation-marker-fg:',
    '--tplane-chat-citation-radius:',
    '--tplane-chat-citation-type-web-fg:',
    '--tplane-chat-citation-type-web-bg:',
    '--tplane-chat-citation-type-web-border:',
    '--tplane-chat-citation-type-file-fg:',
    '--tplane-chat-citation-type-file-bg:',
    '--tplane-chat-citation-type-file-border:',
    '--tplane-chat-citation-type-app-fg:',
    '--tplane-chat-citation-type-app-bg:',
    '--tplane-chat-citation-type-app-border:',
    '--tplane-chat-citation-type-memory-fg:',
    '--tplane-chat-citation-type-memory-bg:',
    '--tplane-chat-citation-type-memory-border:',
    '--tplane-chat-citation-type-generic-fg:',
    '--tplane-chat-citation-type-generic-bg:',
    '--tplane-chat-citation-type-generic-border:',
  ])('defines %s', (decl) => {
    expect(ROOT_TOKEN_STYLES).toContain(decl);
  });

  it.each([
    ['web', '#1d4ed8', '#eaf1fd'],
    ['file', '#2f684c', '#edf7f1'],
    ['app', '#7a4d12', '#fff5e3'],
    ['memory', '#67508f', '#f3effb'],
    ['generic', '#526071', '#f4f6f8'],
  ])('keeps light %s citation type text at AA contrast', (_type, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

describe('ROOT_TOKEN_STYLES — success colors', () => {
  it('keeps the icon success color and adds a separate text success color', () => {
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-success: #16a34a;');
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-success-text: #15803d;');
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-success-text: #4ade80;');
  });

  it.each([
    ['light surface', '#15803d', '#ffffff'],
    ['light surface-alt', '#15803d', '#fbfbfb'],
    ['dark surface', '#4ade80', '#1c1c1c'],
    ['dark surface-alt', '#4ade80', '#2c2c2c'],
  ])('success text meets AA contrast on the %s', (_surface, fg, bg) => {
    expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
  });
});

function relativeLuminance(hex: string): number {
  const [r, g, b] = hex
    .replace('#', '')
    .match(/../g)!
    .map((part) => {
      const channel = parseInt(part, 16) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(foreground: string, background: string): number {
  const fg = relativeLuminance(foreground);
  const bg = relativeLuminance(background);
  return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
}

describe('ROOT_TOKEN_STYLES — theme attribute selectors', () => {
  it.each([
    '[data-theme="light"]',
    '[data-theme="dark"]',
    '[data-threadplane-chat-theme="light"]',
    '[data-threadplane-chat-theme="dark"]',
  ])('honors %s as a theme override hook', (selector) => {
    // Both `data-theme` (consumer-facing override) and `data-threadplane-chat-theme`
    // (the chat-lib-internal attribute documented for app-shells that
    // already use `data-theme` for their own picker) must flip tokens.
    expect(ROOT_TOKEN_STYLES).toContain(selector);
  });
});

/** Value of a token from the explicit-theme block of ROOT_TOKEN_STYLES. */
function themeBlock(theme: 'light' | 'dark'): string {
  const marker = `[data-threadplane-chat-theme="${theme}"] {`;
  const start = ROOT_TOKEN_STYLES.indexOf(marker);
  return ROOT_TOKEN_STYLES.slice(start + marker.length, ROOT_TOKEN_STYLES.indexOf('}', start));
}

function tokenValue(theme: 'light' | 'dark', name: string): string {
  const match = new RegExp(`--tplane-chat-${name}:\\s*([^;]+);`).exec(themeBlock(theme));
  return match ? match[1].trim() : '';
}

function parseColor(value: string): string {
  const rgb = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(value);
  if (!rgb) return value;
  return '#' + [rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}

function contrast(a: string, b: string): number {
  return contrastRatio(parseColor(a), parseColor(b));
}

describe('ROOT_TOKEN_STYLES — a2ui focus alias', () => {
  it('aliases --a2ui-focus-ring-color to the chat focus token in both themes, once', () => {
    for (const theme of ['light', 'dark'] as const) {
      expect(themeBlock(theme)).toContain('--a2ui-focus-ring-color: var(--tplane-chat-focus-ring);');
    }
    expect(ROOT_TOKEN_STYLES).not.toContain('--a2ui-focus-ring-color: var(--a2ui-primary)');
  });
});

describe('ROOT_TOKEN_STYLES — status families', () => {
  it.each(['success-bg', 'success-border', 'warning-border', 'elevation-float', 'scrim'])(
    'declares --tplane-chat-%s in light and dark', (name) => {
      expect(tokenValue('light', name)).toBeTruthy();
      expect(tokenValue('dark', name)).toBeTruthy();
      expect(tokenValue('dark', name)).not.toEqual(tokenValue('light', name));
    });
  it.each([
    ['error-text', 'error-bg'], ['warning-text', 'warning-bg'], ['success-text', 'success-bg'],
    ['text-muted', 'surface'], ['text-muted', 'surface-alt'], ['on-destructive', 'destructive'],
  ])('--tplane-chat-%s meets 4.5:1 on --tplane-chat-%s in both themes', (fg, bg) => {
    for (const theme of ['light', 'dark'] as const) {
      expect(contrast(tokenValue(theme, fg), tokenValue(theme, bg))).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('declares one focus ring and the motion tokens', () => {
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-focus-ring: var(--tplane-chat-primary)');
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-motion-duration: 150ms');
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-motion-duration-slow: 250ms');
    expect(ROOT_TOKEN_STYLES).toContain('--tplane-chat-motion-ease: cubic-bezier(0.22, 1, 0.36, 1)');
  });
  it('keeps the shadow tokens as aliases of the elevation token', () => {
    for (const size of ['sm', 'md', 'lg']) {
      expect(tokenValue('light', `shadow-${size}`)).toBe('var(--tplane-chat-elevation-float)');
    }
  });
  it('declares the focus-ring and shadow aliases in both theme blocks', () => {
    // A var() alias resolves where it is declared, so a :root-only alias
    // would keep the light value under a [data-theme="dark"] wrapper.
    for (const theme of ['light', 'dark'] as const) {
      expect(tokenValue(theme, 'focus-ring')).toBe('var(--tplane-chat-primary)');
      for (const size of ['sm', 'md', 'lg']) {
        expect(tokenValue(theme, `shadow-${size}`)).toBe('var(--tplane-chat-elevation-float)');
      }
    }
  });
});
