// libs/angular/chat/src/lib/compositions/chat-popup/chat-popup.styles.spec.ts
//
// WHAT THIS PINS. The popup launcher was pinned to the viewport corner with a
// hard-coded `bottom: 1rem; right: 1rem`, so an application with a bottom bar,
// a cookie banner, or its own floating control had no way to move it short of
// overriding the component's styles. Two custom properties make the offsets
// part of the theming surface, and the anchored window has to read the same
// horizontal offset or an override would leave it misaligned with the button.
import { describe, expect, it } from 'vitest';
import { ChatPopupComponent } from './chat-popup.component';
import { ɵROOT_TOKEN_STYLES as ROOT_TOKEN_STYLES } from '@threadplane/angular/chat/shared';

/** The component's compiled style strings. */
function popupStyles(): string {
  const meta = ChatPopupComponent as unknown as {
    ɵcmp: { styles: readonly string[] };
  };
  return meta.ɵcmp.styles.join('\n');
}

/**
 * The declaration block whose selector contains `selector`. Compiled styles
 * carry Angular's `[_ngcontent-…]` scoping attributes, so the selector text is
 * matched loosely and only the braces are used to find the block's end.
 */
function ruleBody(styles: string, selector: string): string {
  const at = styles.indexOf(selector);
  expect(at, `no rule found for ${selector}`).toBeGreaterThanOrEqual(0);
  const open = styles.indexOf('{', at);
  return styles.slice(open + 1, styles.indexOf('}', open));
}

describe('chat-popup launcher offset tokens', () => {
  it.each([
    '--tplane-chat-launcher-offset-x: 1rem;',
    '--tplane-chat-launcher-offset-y: 1rem;',
  ])('defines a default for %s on :root', (decl) => {
    expect(ROOT_TOKEN_STYLES).toContain(decl);
  });

  it('positions the launcher host from the offset tokens', () => {
    const styles = popupStyles();

    expect(styles).toContain('bottom: var(--tplane-chat-launcher-offset-y)');
    expect(styles).toContain('right: var(--tplane-chat-launcher-offset-x)');
  });

  it('anchors the popup window to the same horizontal offset', () => {
    expect(
      ruleBody(popupStyles(), '.chat-popup__window'),
      'the window must track the launcher when the offset is overridden'
    ).toContain('right: var(--tplane-chat-launcher-offset-x)');
  });

  it('leaves no hard-coded corner offsets on the launcher host', () => {
    expect(ruleBody(popupStyles(), '[_nghost')).not.toMatch(
      /(bottom|right):\s*1rem/
    );
  });
});
