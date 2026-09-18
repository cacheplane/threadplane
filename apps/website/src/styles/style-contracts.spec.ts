import { describe, expect, it } from 'vitest';
import { declarationsFor, loadStylesheet } from './style-contract';

/**
 * The registry of CSS declarations that are load-bearing and whose loss is
 * silent — the page still renders, just wrongly.
 *
 * Add an entry when you find yourself writing a comment in a stylesheet that
 * explains why a declaration must not be removed. That comment is the tell:
 * the next person cannot see the consequence from the code, and neither can
 * jsdom.
 *
 * Do not add ordinary styling here. A contract that fires on every design
 * tweak teaches people to delete contracts.
 */
interface StyleContract {
  file: string;
  selector: string;
  /** Why losing this is invisible. Read by whoever the failure wakes up. */
  why: string;
  requires: Record<string, RegExp>;
}

const CONTRACTS: StyleContract[] = [
  {
    file: 'docs.css',
    selector: '.docs-sidebar-lib-item-text',
    why: 'Title and tagline are sibling spans; this column is the only thing stacking them. Losing it renders every picker row as one run-on line — shipped to production in #892.',
    requires: {
      display: /display:\s*flex/,
      'flex-direction': /flex-direction:\s*column/,
    },
  },
  {
    file: 'docs.css',
    selector: '.docs-sidebar-lib-menu',
    why: 'The picker menu opens ~340px down a scrolling pane. Without a cap it runs past the fold and the last libraries are unreachable.',
    requires: {
      'max-height': /max-height:/,
      'overflow-y': /overflow-y:\s*auto/,
    },
  },
  {
    file: 'docs.css',
    selector: '.docs-control-plane',
    why: 'In a flex row an un-aligned sticky child stretches to the article\'s full height, so its own height cap never applies and internal scrolling silently stops working.',
    requires: {
      position: /position:\s*sticky/,
      'align-self': /align-self:\s*flex-start/,
    },
  },
  {
    file: 'docs.css',
    selector: '.docs-prose a:not([data-mdx-chrome])',
    why: 'Tailwind Typography is inert in this app — `.prose` emits zero rules, so `--tw-prose-links` on MdxRenderer set a variable nothing read and every docs link rendered as plain body text (measured: rgb(28,28,28), no decoration). This rule is the only thing making a docs link look like a link.',
    requires: {
      color: /color:\s*var\(--color-accent\)/,
      'text-decoration': /text-decoration:\s*underline/,
    },
  },
  {
    file: 'docs.css',
    selector: '[data-mdx="callout"] .mdx-callout-body a:not([data-mdx-chrome])',
    why: "A callout's body text is already muted, so an accent-blue link inside a warning callout reads as a rendering error. Losing this leaves callout links legible but wrongly toned — the failure nobody reports.",
    requires: {
      color: /color:\s*var\(--callout-tone-text\)/,
      'font-weight': /font-weight:\s*500/,
    },
  },
  {
    file: 'docs.css',
    selector: '.docs-prose a[href^="http"]:not([data-mdx-chrome])::after',
    why: 'The only signal that a docs link leaves the site. Losing it renders an off-site link identically to an in-site one, which is invisible until someone loses their place.',
    requires: {
      content: /content:/,
    },
  },
  {
    file: '../app/global.css',
    selector: 'pre.shiki',
    why: "Shiki writes the theme background inline on the <pre> but emits no padding, so losing this sits the code flush against the dark surface's edges — on the homepage Code tabs, /langgraph, /render, /chat and every /solutions page. Deleted once already in #863, on a docs-only survey that concluded `.shiki` matched nothing.",
    requires: {
      padding: /padding:/,
    },
  },
  {
    file: 'docs.css',
    selector: '.docs-control-plane [data-control-plane-pane]',
    why: 'The pane holds the whole docs nav in a fixed-height column. Without its own scrolling the lower sections are unreachable on short viewports.',
    requires: {
      'overflow-y': /overflow-y:\s*auto/,
    },
  },
  {
    file: 'docs.css',
    selector: '.website-workspace-host',
    why: 'The fixed site nav remains outside the workspace. This wrapper owns the remaining viewport and prevents the page footer from creating a second scroller.',
    requires: {
      height: /height:\s*100dvh/,
      'padding-top': /padding-top:\s*var\(--nav-h\)/,
      overflow: /overflow:\s*hidden/,
    },
  },
  {
    file: 'docs.css',
    selector: '.website-workspace-host .workspace-shell',
    why: 'The shared shell uses h-screen by default; the Website host must subtract its fixed nav or the bottom of every workspace panel is clipped.',
    requires: {
      height: /height:\s*calc\(100dvh\s*-\s*var\(--nav-h\)\)/,
    },
  },
  {
    file: 'docs.css',
    selector: '#site-content:has([data-website-workspace-host])',
    why: 'Workspace routes own the viewport beneath the global nav and must not inherit ordinary page/footer scrolling.',
    requires: {
      height: /height:\s*100dvh/,
      overflow: /overflow:\s*hidden/,
    },
  },
  {
    file: 'docs.css',
    selector: '#site-content:has([data-website-workspace-host]) > .footer-root',
    why: 'The workspace is a full-height surface; the ordinary marketing footer must not add document height behind it.',
    requires: {
      display: /display:\s*none/,
    },
  },
  {
    file: 'docs.css',
    selector: 'html:has([data-website-workspace-host])',
    why: 'Workspace routes must lock the document scroll root so oversized control-plane descendants cannot create a second vertical scroller outside the article panel.',
    requires: {
      height: /height:\s*100%/,
      overflow: /overflow:\s*hidden/,
      'overscroll-behavior': /overscroll-behavior:\s*none/,
    },
  },
  {
    file: 'docs.css',
    selector: 'body:has([data-website-workspace-host])',
    why: 'The body must join the route-scoped root lock; locking only the shell still lets descendant min-content inflate document scrolling.',
    requires: {
      height: /height:\s*100%/,
      overflow: /overflow:\s*hidden/,
      'overscroll-behavior': /overscroll-behavior:\s*none/,
    },
  },
  {
    file: 'docs.css',
    selector: '.tp-diagram-figure',
    why: 'Diagram SVGs are wider than the article column on narrow viewports. Without horizontal scrolling the figure either overflows the page or gets silently clipped.',
    requires: {
      'overflow-x': /overflow-x:\s*auto/,
    },
  },
  {
    file: 'docs.css',
    selector: '.tp-diagram-svg',
    why: 'The docs-scale cap keeps diagrams from ballooning past a readable width in the article column; losing it lets the SVG stretch to the full (scrollable) figure width instead. The 600px floor keeps SVG text at >=94% of designed size on phones (shrinking the box shrinks the type with it) while still fitting the ~632px desktop column scroll-free.',
    requires: {
      'max-width': /max-width:\s*680px/,
      'min-width': /min-width:\s*600px/,
    },
  },
  {
    file: 'docs.css',
    selector: '.tp-diagram-figure[data-scale="compact"] .tp-diagram-svg',
    why: 'Compact card diagrams must never inherit the 600px phone floor: inside a grid card that floor would force an internal scroll where none is affordable. Losing the min-width override silently reintroduces that 600px floor. Losing the max-width cap lets a wide grid card scale the diagram past its tuned compact type ramp, ballooning the text.',
    requires: {
      'min-width': /min-width:\s*0/,
      'max-width': /max-width:\s*420px/,
    },
  },
  {
    file: 'forms.css',
    selector: '[data-ui="form-control"]',
    why: 'Every form control shares one height and one focus ring. If either goes, inputs silently drift back to five sizes and lose keyboard visibility.',
    requires: {
      height: /height:\s*var\(--form-control-height\)/,
    },
  },
  {
    file: 'forms.css',
    selector: '[data-ui="form-control"]:focus-visible',
    why: 'WCAG 2.2 focus appearance. Without this ring keyboard users cannot see which field is active.',
    requires: {
      'box-shadow': /box-shadow:\s*var\(--form-focus-ring\)/,
    },
  },
  {
    file: 'forms.css',
    selector: '[data-ui="form-control"][aria-invalid="true"]',
    why: 'Errors are text plus a ring. Losing the ring leaves the icon-and-text line as the only cue, which reads as help text at a glance.',
    requires: {
      'box-shadow': /box-shadow:\s*var\(--form-error-ring\)/,
    },
  },
  {
    file: 'forms.css',
    selector: '[data-ui="form-row"]',
    why: 'The footer newsletter row once put its disclosure inside the flex row and the input collapsed to 26px. The row must only ever hold controls.',
    requires: {
      display: /display:\s*flex/,
      gap: /gap:/,
    },
  },
  {
    file: 'pages.css',
    selector: '.contact-band',
    why: 'Heading column and form card are grid siblings; without the grid the card drops below the heading and the page reads as the old single column.',
    requires: {
      display: /display:\s*grid/,
      'grid-template-columns': /grid-template-columns:/,
    },
  },
  {
    file: 'landing.css',
    selector: '.shiki[data-ui="highlighted-code"] > pre.shiki',
    why: 'A code pane that clips is silent: macOS overlay scrollbars draw nothing until a scroll starts (measured — `scrollbar-width` and `::-webkit-scrollbar` both leave 0px of layout gutter there), so the runtime-parity pane shipped ending mid-string at `assistantId: \'agent` (scrollWidth 609 / clientWidth 550 at 1440px) and looked complete. Wrapping is the fix, not the scrollbar: `pre-wrap` folds at existing whitespace and `break-word` catches the run that has none. Losing either leaves a pane that hides its payload with no affordance.',
    requires: {
      'white-space': /white-space:\s*pre-wrap/,
      'overflow-wrap': /overflow-wrap:\s*break-word/,
      'overflow-x': /overflow-x:\s*auto/,
    },
  },
  {
    file: 'landing.css',
    selector: '.install-dialog-command',
    why: 'The install command is the primary CTA\'s entire payload — 774px of shell in a 470px pane, so the reader saw `npm install @threadplane/chat @threadplane/langgraph @langcha…`. It is one line with no meaningful breaks, so it must wrap rather than scroll. Losing this silently truncates the one string the page exists to hand over.',
    requires: {
      'white-space': /white-space:\s*pre-wrap/,
      'overflow-wrap': /overflow-wrap:\s*anywhere/,
    },
  },
  {
    file: 'ui.css',
    selector: '[data-ui="button"]:focus-visible',
    why: "Without this the UA default `outline: auto 1px rgb(0, 95, 204)` draws a blue hairline straight on the primary button's own fill — invisible. Closing the install dialog returns focus to that button, so the keyboard user is left with no idea where they are. The ring uses --color-accent, which every section scope re-points, so it survives on all three grounds: scope navy (#15253E) against the signal-yellow fill on white, aviation yellow inside the dark band, and ink inside the signal scope, where the primary button inverts to an ink fill.",
    requires: {
      outline: /outline:\s*2px\s+solid\s+var\(--color-accent\)/,
      'outline-offset': /outline-offset:\s*2px/,
    },
  },
  {
    file: 'landing.css',
    selector: '.hero-demo-play',
    why: 'The play control renders on the reduced-motion path, at any width — autoplay is no longer width-gated — and sits on a near-black poster. It previously had `background: #111` and a black shadow, which read as bare white text with no button chrome. The light fill and dark ring are what make it look clickable. The fill is also fully opaque: at 97% the phone poster\'s own "Take control ↗" text read straight through it.',
    requires: {
      background: /background:\s*rgb\(248 248 248\)/,
      border: /border:\s*1px solid/,
      'min-height': /min-height:\s*44px/,
    },
  },
  {
    file: 'landing.css',
    selector: '.hero-demo-stage picture',
    why: 'The hero poster — the page\'s LCP element — is `height: 100%` of the stage. Wrapping it in a <picture> for the phone-width source put an inline box with no height of its own in between, so without an explicit block height here the percentage resolves against `auto` and the poster collapses to nothing.',
    requires: {
      display: /display:\s*block/,
      height: /height:\s*100%/,
    },
  },
  {
    file: 'landing.css',
    selector: '.marker-highlight',
    why: 'The hero subhead is centered and the highlighted boundary claim wraps at every width below ~1200px (it wraps mid-phrase at 390px). Without box-decoration-break: clone the browser paints ONE background box spanning the union of the wrapped lines, so the marker bleeds across the full paragraph width and past the text it is meant to emphasise — it still renders, just wrongly. The negative margins cancel the padding so the highlight does not shift the line box.',
    requires: {
      'box-decoration-break': /[^-]box-decoration-break:\s*clone/,
      '-webkit-box-decoration-break': /-webkit-box-decoration-break:\s*clone/,
    },
  },
];

function baseDeclarationsFor(css: string, selector: string): string {
  const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
  let depth = 0;
  let ruleStart = 0;

  for (let index = 0; index < withoutComments.length; index += 1) {
    const character = withoutComments[index];
    if (character === '{') {
      if (depth === 0) {
        const ruleSelector = withoutComments.slice(ruleStart, index).trim();
        const close = withoutComments.indexOf('}', index + 1);
        if (ruleSelector === selector && close !== -1) {
          return withoutComments.slice(index + 1, close);
        }
      }
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) ruleStart = index + 1;
    }
  }

  return '';
}

// Two rules with the same `@media` query are legitimate CSS — the second
// docs.css author to add a `(pointer: coarse)` block should not have to know
// about the first one. Returning only the first match here would silently
// hand a contract the wrong block's contents instead of erroring, exactly
// the failure mode declarationsFor() already avoids by merging every rule
// that matches a selector. So this merges every block for the query too.
//
// Matching is on the *complete* query text (the text between `@media` and
// the opening `{`, trimmed) rather than a substring, so a compound query
// like `(pointer: coarse) and (min-width: 600px)` is a different query and
// never gets folded into a plainer `(pointer: coarse)` lookup.
function mediaBlock(css: string, query: string): string {
  const blocks: string[] = [];
  let searchFrom = 0;

  for (;;) {
    const start = css.indexOf('@media', searchFrom);
    if (start === -1) break;
    const open = css.indexOf('{', start);
    if (open === -1) break;

    const actualQuery = css.slice(start + '@media'.length, open).trim();
    let depth = 0;
    let end = -1;

    for (let index = open; index < css.length; index += 1) {
      if (css[index] === '{') depth += 1;
      if (css[index] === '}') {
        depth -= 1;
        if (depth === 0) {
          end = index;
          break;
        }
      }
    }

    if (end === -1) break;
    if (actualQuery === query) {
      blocks.push(css.slice(open + 1, end));
    }
    searchFrom = end + 1;
  }

  return blocks.join('\n');
}

describe('style contracts', () => {
  for (const contract of CONTRACTS) {
    describe(`${contract.file} ${contract.selector}`, () => {
      const declarations = declarationsFor(loadStylesheet(contract.file), contract.selector);

      it('has a rule at all', () => {
        // A selector that stops matching is the loudest way this drifts: the
        // rule was renamed or deleted and every property assertion below would
        // otherwise fail with the same unhelpful message.
        expect(declarations, contract.why).not.toBe('');
      });

      for (const [property, pattern] of Object.entries(contract.requires)) {
        it(`declares ${property}`, () => {
          expect(declarations, contract.why).toMatch(pattern);
        });
      }
    });
  }

  describe('docs.css page actions geometry and tooltip', () => {
    const css = loadStylesheet('docs.css');
    const trigger = baseDeclarationsFor(css, '.docs-page-actions-trigger');
    const tooltip = declarationsFor(css, '.docs-page-actions-tooltip');

    it('keeps the base trigger a borderless 44px rounded square outside media queries', () => {
      expect(trigger).toMatch(/width:\s*44px/);
      expect(trigger).toMatch(/height:\s*44px/);
      expect(trigger).toMatch(/border:\s*0/);
      expect(trigger).toMatch(/border-radius:\s*(?:8px|var\(--radius-[^)]+\))/);
    });

    it('transitions tooltip opacity and visibility over 120ms', () => {
      expect(tooltip).toMatch(/transition:[^;]*opacity\s+120ms[^;]*visibility\s+120ms/);
    });

    it('reveals the tooltip for trigger hover and keyboard focus', () => {
      for (const selector of [
        '.docs-page-actions-trigger:hover + .docs-page-actions-tooltip',
        '.docs-page-actions-trigger:focus-visible + .docs-page-actions-tooltip',
      ]) {
        const declarations = declarationsFor(css, selector);
        expect(declarations).toMatch(/opacity:\s*1/);
        expect(declarations).toMatch(/visibility:\s*visible/);
      }
    });

    it('keeps the tooltip interactive, hover-persistent, and bridged to the trigger', () => {
      expect(tooltip).toMatch(/pointer-events:\s*auto/);

      const hover = declarationsFor(css, '.docs-page-actions-tooltip:hover');
      expect(hover).toMatch(/opacity:\s*1/);
      expect(hover).toMatch(/visibility:\s*visible/);

      const bridge = declarationsFor(css, '.docs-page-actions-tooltip::before');
      expect(bridge).toMatch(/content:\s*['"]["']/);
      expect(bridge).toMatch(/position:\s*absolute/);
      expect(bridge).toMatch(/top:\s*-6px/);
      expect(bridge).toMatch(/left:\s*0/);
      expect(bridge).toMatch(/right:\s*0/);
      expect(bridge).toMatch(/height:\s*6px/);
    });

    it('suppresses the tooltip on coarse pointers', () => {
      expect(declarationsFor(mediaBlock(css, '(pointer: coarse)'), '.docs-page-actions-tooltip')).toMatch(/display:\s*none/);
    });

    it('removes tooltip transitions when reduced motion is requested', () => {
      expect(declarationsFor(mediaBlock(css, '(prefers-reduced-motion: reduce)'), '.docs-page-actions *')).toMatch(/transition:\s*none\s*!important/);
    });

    it('hides the shortcut hint on coarse pointers', () => {
      expect(
        declarationsFor(mediaBlock(css, '(pointer: coarse)'), '.docs-control-plane-search-kbd')
      ).toMatch(/display:\s*none/);
    });

    it('does not merge a compound query into a simpler one', () => {
      const compoundCss = `
        @media (pointer: coarse) { .a { color: red; } }
        @media (pointer: coarse) and (min-width: 600px) { .b { color: blue; } }
      `;
      expect(mediaBlock(compoundCss, '(pointer: coarse)')).toContain('.a');
      expect(mediaBlock(compoundCss, '(pointer: coarse)')).not.toContain('.b');
    });
  });

  describe('landing.css hero demo stage ratio', () => {
    const css = loadStylesheet('landing.css');
    const phone = mediaBlock(css, '(max-width: 767px)');

    /**
     * The stage box, not the image, is what `object-fit: cover` crops against.
     * The phone poster is a 390x650 capture, so the stage has to hold 3:5 below
     * the breakpoint; at the desktop 1200/720 it would letterbox the portrait
     * frame down to a two-line sliver. This replaces a `4 / 5` +
     * `object-position: 40% top` pair that existed only to crop the DESKTOP
     * capture into something readable, which sliced the right edge off every
     * line of prose.
     */
    it('holds the phone poster ratio below the breakpoint', () => {
      expect(declarationsFor(phone, '.hero-demo-stage')).toMatch(/aspect-ratio:\s*3\s*\/\s*5/);
    });

    it('keeps the desktop stage at the desktop capture ratio', () => {
      expect(baseDeclarationsFor(css, '.hero-demo-stage')).toMatch(/aspect-ratio:\s*1200\s*\/\s*720/);
    });

    /**
     * With the asset and the stage on the same ratio, cover crops nothing.
     * A re-introduced object-position would mean someone is cropping again.
     */
    it('does not nudge the poster away from its own frame', () => {
      expect(declarationsFor(phone, '.hero-demo-poster')).not.toMatch(/object-position:/);
      expect(baseDeclarationsFor(css, '.hero-demo-poster')).not.toMatch(/object-position:/);
    });

    /**
     * Guards the two assertions above against passing vacuously: landing.css
     * carries several `(max-width: 767px)` blocks, and mediaBlock() merges
     * them, so an empty merge would satisfy every `not.toMatch` here.
     */
    it('actually found the phone block', () => {
      expect(phone).toContain('.hero-demo-stage');
    });
  });

  /**
   * The compatibility band's accessibility rests entirely on one CSS idiom,
   * and nothing else in the repo can see it break. The plate is
   * `aria-hidden="true"`, so `.airport-stack` is the section's only accessible
   * content — and the five model-provider names and the "never talks to them"
   * claim exist nowhere else in the DOM. Switch the desktop rule to
   * `display: none` and every unit test and every e2e case stays green while a
   * screen reader hears an empty section. A review of this band already caught
   * exactly that once.
   */
  describe('landing.css airport stack is hidden visually, never removed', () => {
    const css = loadStylesheet('landing.css');
    const desktop = baseDeclarationsFor(css, '.airport-stack');
    const narrow = mediaBlock(css, '(max-width: 1023px)');

    it('hides the desktop stack with the clip-path idiom', () => {
      // Asserted positively first so the `not.toMatch` below cannot pass
      // against an empty string if the rule is ever renamed away.
      expect(desktop, '.airport-stack has no rule outside a media query').not.toBe('');
      expect(desktop).toMatch(/position:\s*absolute/);
      expect(desktop).toMatch(/clip-path:\s*inset\(50%\)/);
      expect(desktop).toMatch(/width:\s*1px/);
    });

    it('never takes the stack out of the accessibility tree', () => {
      expect(desktop).not.toMatch(/display:\s*none/);
      expect(desktop).not.toMatch(/visibility:\s*hidden/);
    });

    /**
     * The plate and the stack must swap at the same width, or one viewport
     * band gets both or neither. 1023px rather than the usual 767px is
     * measured: `.ap-svg` is `width: 100%`, so at 768px the 1000-unit plate
     * renders at ~0.71 and its callsigns land at 6px.
     */
    it('swaps the plate for the stack at one breakpoint', () => {
      expect(declarationsFor(narrow, '.airport-figure')).toMatch(/display:\s*none/);
      expect(declarationsFor(narrow, '.airport-stack')).toMatch(/position:\s*static/);
      expect(declarationsFor(narrow, '.airport-stack')).toMatch(/clip-path:\s*none/);
    });
  });

  describe('landing.css stage act', () => {
    const css = loadStylesheet('landing.css');

    /**
     * The engine sets the act's inline height and sticks `[data-sc-stage]`
     * only if the stylesheet already makes it sticky; when it is not, the
     * engine warns to the console and the act scrolls straight through.
     * Cues start hidden so the engine's per-frame opacity is the only thing
     * that reveals a rail block.
     */
    it('the stage pin is sticky — the engine only warns when it is not', () => {
      expect(declarationsFor(css, '.stage-pin')).toMatch(/position:\s*sticky/);
      expect(declarationsFor(css, '.stage-act [data-sc-cue]')).toMatch(
        /opacity:\s*0/
      );
    });

    /**
     * The cues stack in one grid cell and are hidden by opacity alone, so a
     * hidden ledger sits over the visible beat block and would take the click
     * meant for its docs link. No cue owns the pointer until the publisher
     * marks the block `now` or the ledger active.
     */
    it("a hidden cue does not intercept the visible one's clicks", () => {
      expect(declarationsFor(css, '.stage-act [data-sc-cue]')).toMatch(
        /pointer-events:\s*none/
      );
      expect(
        declarationsFor(css, ".stage-rail-beat[data-beat-state='now']")
      ).toMatch(/pointer-events:\s*auto/);
      expect(declarationsFor(css, '.stage-rail-close[data-active]')).toMatch(
        /pointer-events:\s*auto/
      );
    });

    /**
     * The rail's state is written as attributes by the publisher, not React,
     * so nothing in a component test notices when the attribute has no rule
     * behind it: the segment bar would never light and the checks never fill,
     * and the ledger must share the cues' one cell: when it spanned two rail
     * rows instead, the grid split its height across both and pushed the hold
     * line ~150px below the beat block.
     */
    it('shows square checks in persistent rows without dividing lines', () => {
      expect(declarationsFor(css, '.stage-check')).toMatch(
        /border-radius:\s*5px/
      );
      expect(declarationsFor(css, '.stage-check[data-checked]')).toMatch(
        /background:/
      );
      expect(declarationsFor(css, '.stage-rail-beat')).toMatch(
        /display:\s*flex/
      );
      expect(declarationsFor(css, '.stage-rail-beat')).not.toMatch(
        /border-bottom:|grid-area:/
      );
      expect(declarationsFor(css, '.stage-checklist')).toMatch(
        /display:\s*grid/
      );
    });
  });
});
