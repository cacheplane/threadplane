import { test, expect } from '@playwright/test';

// Mirrored from apps/website/src/lib/growth/form-policy.ts, which is server-only
// and therefore cannot be imported into a Playwright spec.
// Hardcoded rather than imported: lib/growth/form-policy.ts is `server-only`
// and cannot be pulled into a Playwright process. It must be updated whenever
// GROWTH_FORM_POLICY_VERSION is bumped -- this literal is compared against what
// the running app actually posts, so a stale copy fails the suite rather than
// passing silently.
const GROWTH_FORM_POLICY_VERSION = 'growth_v1.2026-09-09';
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

const docsRoute = '/docs/langgraph/getting-started/introduction';

async function expectNoHorizontalOverflow(
  page: import('@playwright/test').Page,
  label: string,
) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, label).toBeLessThanOrEqual(1);
}

test('landing page renders hero headline', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#hero-heading')).toBeVisible();
  // This also carries the guard that the hero names the framework. That guard
  // used to live on .hero-eyebrow, because the H1 was framework-neutral; the H1
  // names Angular itself now, so the eyebrow no longer repeats it. Asserting
  // "Angular" separately here would be green by construction — the literal
  // above already contains it — so the full-text pin is the whole check.
  await expect(page.locator('#hero-heading')).toHaveText('The open-source thread-plane for Angular agents.');
});

test('the default social card renders as a PNG', async ({ request }) => {
  // The default card is rendered at request time, so a Satori rejection — a
  // div with two children and no explicit `display`, a font it cannot parse —
  // is a 500 on the live route rather than a build failure. The blog's cards
  // are prerendered and already fail the build, so only this one needs a
  // runtime check.
  const res = await request.get('/opengraph-image');
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('image/png');
  expect((await res.body()).byteLength).toBeGreaterThan(10_000);
});

test('landing page renders the dark proof band', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#proof-heading')).toBeVisible();
  await expect(page.locator('#proof[data-surface="dark"]')).toBeVisible();
});

test('landing page renders the spine in order (live-stage spec §3)', async ({ page }) => {
  await page.goto('/');
  const ids = [
    'hero-heading',
    'proof-heading',
    'compatibility-heading',
    'architecture-heading',
    'no-runtime-heading',
    'open-source-heading',
    'stage-heading',
    'field-report-heading',
    'faq-heading',
  ];
  const tops: number[] = [];
  for (const id of ids) {
    const el = page.locator(`#${id}`);
    await expect(el).toBeAttached();
    tops.push((await el.boundingBox())?.y ?? -1);
  }
  expect([...tops].sort((a, b) => a - b)).toEqual(tops);
  await expect(page.locator('#test-heading')).toHaveCount(0);
  await expect(page.locator('#parity-heading')).toHaveCount(0);
  await expect(page.locator('#how-it-works-heading')).toHaveCount(0);
  await expect(page.locator('#coding-agent-heading')).toHaveCount(0);
  await expect(page.locator('#whitepaper-block')).toHaveCount(0);
  await expect(page.locator('main form')).toHaveCount(1);
});

test('landing page no longer carries the retired promises section', async ({ page }) => {
  await page.goto('/');
  const main = page.locator('main');

  await expect(main).not.toContainText("What we won't do");
  await expect(main).not.toContainText('No hidden telemetry');
  await expect(main).not.toContainText('Installation is inert');
});

test('every page links the canonical privacy policy from the footer', async ({ page }) => {
  await page.goto('/');

  const link = page.locator('footer a[href="/privacy"]');
  await expect(link).toBeVisible();
  await link.click();
  await expect(page).toHaveURL(/\/privacy$/u);
  await expect(
    page.getByRole('heading', { level: 1, name: /privacy/i })
  ).toBeVisible();
});

test('pricing page presents three software and support paths', async ({ page }) => {
  await page.goto('/pricing');
  const plans = page.locator('.pricing-plan-card');
  await expect(plans).toHaveCount(3);
  await expect(plans.nth(0).getByRole('heading', { level: 3 })).toHaveText('Community');
  await expect(plans.nth(1).getByRole('heading', { level: 3 })).toHaveText('Production Assurance');
  await expect(plans.nth(2).getByRole('heading', { level: 3 })).toHaveText('Enterprise');
  await expect(plans.nth(0)).toContainText('All packages are MIT-licensed');
  await expect(page.getByText('No Threadplane cloud').first()).toBeVisible();
});

test('pricing page routes software and support CTAs without checkout', async ({ page }) => {
  await page.goto('/pricing');

  await expect(page.getByRole('link', { name: 'Install from npm' })).toHaveAttribute('href', /npmjs\.com\/package\/@threadplane\/chat/);
  await expect(page.getByRole('link', { name: 'Discuss assurance' })).toHaveAttribute('href', '/contact?intent=enterprise&entry=pricing_tier_production_assurance');
  await expect(page.getByRole('link', { name: 'Talk to Sales' })).toHaveAttribute('href', '/contact?intent=enterprise&entry=pricing_tier_enterprise');
  await expect(page.locator('form[action*="checkout"]')).toHaveCount(0);
});

test('pricing page is responsive without page-level horizontal overflow', async ({ page }) => {
  for (const width of [375, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/pricing');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `pricing at ${width}px`).toBeLessThanOrEqual(1);
  }
});

test('pricing plan buttons lead to the enterprise contact intent', async ({ page }) => {
  await page.goto('/pricing');
  await expect(page.getByRole('link', { name: 'Talk to Sales' })).toHaveAttribute('href', '/contact?intent=enterprise&entry=pricing_tier_enterprise');
  await expect(page.getByRole('link', { name: 'Request a conversation' })).toHaveAttribute('href', '/contact?intent=enterprise&entry=pricing_enterprise_band');
  await expect(page.locator('#lead-form')).toHaveCount(0);
});

test('contact page submits a lead payload and renders success state', async ({ page }) => {
  let leadPayload: Record<string, unknown> | undefined;
  await page.route('**/api/leads', async (route) => {
    leadPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/contact');
  const form = page.locator('main form').first();
  await form.getByLabel('Work email').fill('jane@acme.com');
  await form.getByLabel('Name').fill('Jane Smith');
  await form.getByLabel('Company').fill('Acme');
  await form.getByLabel('What are you shipping?').fill('We are evaluating Threadplane.');
  await form.getByRole('button', { name: 'Send to Brian' }).click();

  await expect(page.getByRole('status')).toContainText('Sent.');
  expect(leadPayload).toMatchObject({
    form_kind: 'contact',
    email: 'jane@acme.com',
    name: 'Jane Smith',
    company: 'Acme',
    message: 'We are evaluating Threadplane.',
    policy_version: GROWTH_FORM_POLICY_VERSION,
  });
  expect(leadPayload?.['submission_id']).toMatch(UUID_V4);
});

test('contact page enterprise intent posts the pricing form kind with a timeline', async ({ page }) => {
  let leadPayload: Record<string, unknown> | undefined;
  await page.route('**/api/leads', async (route) => {
    leadPayload = route.request().postDataJSON();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) });
  });

  await page.goto('/contact?intent=enterprise&entry=pricing_tier_enterprise');
  const form = page.locator('main form').first();
  await form.getByRole('button', { name: 'Request a conversation' }).click();
  await expect(form.getByText('Enter your email address.')).toBeVisible();

  await form.getByLabel('Work email').fill('jane@acme.com');
  await form.getByLabel('Company').fill('Acme');
  await form.getByLabel('Timeline').selectOption('this_quarter');
  await form.getByLabel('Tell us about your use case').fill('Volume seats and security review.');
  await form.getByRole('button', { name: 'Request a conversation' }).click();

  await expect(page.getByRole('status')).toContainText('Sent.');
  expect(leadPayload).toMatchObject({
    form_kind: 'pricing',
    email: 'jane@acme.com',
    company: 'Acme',
    timeline: 'this_quarter',
    message: 'Volume seats and security review.',
    policy_version: GROWTH_FORM_POLICY_VERSION,
  });
});

test('footer newsletter form posts to /api/newsletter and renders success state', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/newsletter', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto('/pricing');
  const footer = page.locator('footer');
  const input = footer.getByLabel('Email');
  // Regression guard: the disclosure once sat inside the flex row and the input collapsed to 26px.
  expect((await input.boundingBox())?.width ?? 0).toBeGreaterThan(160);
  await input.fill('reader@acme.com');
  await footer.getByRole('button', { name: 'Subscribe' }).click();

  await expect(footer.getByRole('status')).toContainText('Subscribed.');
  expect(payload).toMatchObject({
    email: 'reader@acme.com',
    policy_version: GROWTH_FORM_POLICY_VERSION,
  });
  expect(payload?.['submission_id']).toMatch(UUID_V4);
});

test('whitepaper signup form posts to /api/whitepaper-signup and renders success state', async ({ page }) => {
  let payload: Record<string, unknown> | undefined;
  await page.route('**/api/whitepaper-signup', async (route) => {
    payload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true }),
    });
  });

  await page.goto('/chat');
  await page.locator('#whitepaper-block').getByLabel('Work email').fill('reader@acme.com');
  await page.locator('#whitepaper-block').getByRole('button', { name: 'Get the field report' }).click();

  await expect(page.getByText(/check your inbox/i)).toBeVisible();
  expect(payload).toMatchObject({
    email: 'reader@acme.com',
    paper: 'chat',
    policy_version: GROWTH_FORM_POLICY_VERSION,
  });
  expect(payload?.['submission_id']).toMatch(UUID_V4);
});

test('docs page renders sidebar and content', async ({ page }) => {
  await page.goto('/docs/langgraph/getting-started/introduction');
  await expect(page.locator('aside').first()).toBeVisible();
  await expect(page.locator('article')).toBeVisible();
});

test('docs landing page shows library cards', async ({ page }) => {
  await page.goto('/docs');
  // Assert on card titles, not page text. A bare getByText('Render') passed on
  // a substring of "json-render"; hasText on the card would match the Chat
  // card too, whose blurb mentions json-render. Only the title is the card.
  const titles = page.locator('.docs-index-card-title');
  await expect(titles.filter({ hasText: /^LangGraph$/ })).toBeVisible();
  await expect(titles.filter({ hasText: /^json-render$/ })).toBeVisible();
  await expect(titles.filter({ hasText: /^AG-UI$/ })).toBeVisible();
  await expect(titles.filter({ hasText: /^Chat$/ })).toBeVisible();
});

test('docs landing page carries the control plane', async ({ page }) => {
  await page.goto('/docs');
  await expect(page.getByRole('navigation', { name: 'Docs modes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Choose a library' })).toBeVisible();
});

test('api reference renders in docs', async ({ page }) => {
  await page.goto('/docs/langgraph/api/inject-agent');
  await expect(page.locator('article').first()).toBeVisible();
});

test('footer has pricing link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('footer a[href="/pricing"]').first()).toBeVisible();
});

test('mobile viewport renders nav', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/');
  await expect(page.locator('nav')).toBeVisible();
});

for (const viewport of [
  { width: 1440, height: 900, surface: 'desktop' },
  { width: 768, height: 900, surface: 'tablet' },
  { width: 390, height: 844, surface: 'mobile' },
  { width: 320, height: 844, surface: 'compact mobile' },
] as const) {
  test(`docs ${viewport.surface} keeps the control plane reachable`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto(docsRoute);
    await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
      'data-hydrated',
      'true',
    );
    await expectNoHorizontalOverflow(page, `Docs at ${viewport.width}px`);

    const desktopControlPlane = page.locator('[data-workspace-desktop-navigation]');
    await expect(page.getByRole('button', { name: 'Open menu' })).toBeHidden();
    if (viewport.width >= 1024) {
      await expect(desktopControlPlane).toBeVisible();
      await expect(
        desktopControlPlane.locator('[data-control-plane-pane]'),
      ).toBeVisible();
      await expect(
        desktopControlPlane.getByRole('button', { name: 'Docs', exact: true }),
      ).toBeVisible();
      await expect(
        desktopControlPlane.getByRole('button', { name: 'Search docs' }),
      ).toBeVisible();
    } else if (viewport.width >= 768) {
      await expect(desktopControlPlane).toBeVisible();
      await expect(
        desktopControlPlane.locator('[data-control-plane-pane]'),
      ).toBeHidden();
      const contextTrigger = page.getByRole('button', { name: 'Open context' });
      await expect(contextTrigger).toBeVisible();
      await contextTrigger.click();
      const dialog = page.getByRole('dialog', {
        name: 'Documentation control plane context',
      });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Search docs' })).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(contextTrigger).toBeFocused();
    } else {
      await expect(desktopControlPlane).toBeHidden();
      const navigationTrigger = page.getByRole('button', {
        name: 'Open navigation',
      });
      await expect(navigationTrigger).toBeVisible();
      const triggerBox = await navigationTrigger.boundingBox();
      expect(triggerBox?.width).toBeGreaterThanOrEqual(44);
      expect(triggerBox?.height).toBeGreaterThanOrEqual(44);

      await navigationTrigger.click();
      const dialog = page.getByRole('dialog', {
        name: 'Documentation control plane',
      });
      await expect(dialog).toBeVisible();
      await expect(page.locator('[data-workspace-surface]')).toHaveAttribute('inert', '');
      await expect(page.locator('nav.nav-bar')).toHaveAttribute('inert', '');

      const close = dialog.getByRole('button', { name: 'Close navigation' });
      const closeBox = await close.boundingBox();
      expect(closeBox?.width).toBeGreaterThanOrEqual(44);
      expect(closeBox?.height).toBeGreaterThanOrEqual(44);

      await expect(
        dialog.getByRole('button', { name: 'Docs', exact: true }),
      ).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Search docs' })).toBeVisible();

      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(navigationTrigger).toBeFocused();
    }
  });
}

test('docs forced colors preserve control boundaries and keyboard focus', async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(docsRoute);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true',
  );

  const run = page
    .locator('[data-workspace-desktop-navigation]')
    .getByRole('button', { name: 'Run', exact: true });
  await run.focus();
  const styles = await run.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      borderWidth: style.borderTopWidth,
      outlineStyle: style.outlineStyle,
      outlineWidth: style.outlineWidth,
    };
  });
  expect(Number.parseFloat(styles.borderWidth)).toBeGreaterThan(0);
  expect(styles.outlineStyle).not.toBe('none');
  expect(Number.parseFloat(styles.outlineWidth)).toBeGreaterThan(0);
});

test('docs reduced motion disables mobile drawer transitions and animations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(docsRoute);
  await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
    'data-hydrated',
    'true',
  );
  await page.getByRole('button', { name: 'Open navigation' }).click();

  const overlay = page.getByRole('dialog', {
    name: 'Documentation control plane',
  });
  await expect(overlay).toBeVisible();
  const motion = await overlay.evaluate((element) => {
    const panel = element.querySelector('.workspace-mobile-control-plane-panel');
    const overlayStyle = getComputedStyle(element);
    const panelStyle = panel ? getComputedStyle(panel) : null;
    return {
      overlayAnimation: overlayStyle.animationName,
      overlayTransition: overlayStyle.transitionDuration,
      panelAnimation: panelStyle?.animationName,
      panelTransition: panelStyle?.transitionDuration,
    };
  });
  expect(motion).toEqual({
    overlayAnimation: 'none',
    overlayTransition: '0s',
    panelAnimation: 'none',
    panelTransition: '0s',
  });
});

test('/llms.txt returns plain text', async ({ page }) => {
  const response = await page.goto('/llms.txt');
  expect(response?.headers()['content-type']).toContain('text/plain');
  const body = await page.locator('body').textContent();
  expect(body).toContain('@threadplane/a2ui');
  expect(body).toContain('@threadplane/telemetry');
  expect(body).toContain('ChatMessageListComponent');
  expect(body).not.toContain('ChatMessagesComponent');
});

test('/llms-full.txt includes generated API reference content', async ({ request }) => {
  const response = await request.get('/llms-full.txt');
  expect(response.ok()).toBe(true);
  expect(response.headers()['content-type']).toContain('text/plain');

  const body = await response.text();
  expect(body).toContain('## API Reference (TypeDoc)');
  expect(body).toContain('### a2ui');
  expect(body).toContain('### langgraph');
  expect(body).toContain('### chat');
  // The dedicated telemetry docs library is retired, so its generated API
  // section no longer ships in the public bundle.
  expect(body).not.toContain('### telemetry');
  expect(body).not.toContain('API reference not yet generated');
});

test('robots.txt allows crawling and points at the sitemap', async ({ request }) => {
  const response = await request.get('/robots.txt');
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain('User-Agent: *');
  expect(body).toContain('Allow: /');
  expect(body).toContain('Sitemap: https://threadplane.ai/sitemap.xml');
});

test('sitemap.xml includes configured docs pages', async ({ request }) => {
  const response = await request.get('/sitemap.xml');
  expect(response.ok()).toBe(true);

  const body = await response.text();
  expect(body).toContain('https://threadplane.ai/docs');
  expect(body).toContain('https://threadplane.ai/docs/langgraph/getting-started/introduction');
  expect(body).toContain('https://threadplane.ai/docs/chat/a2ui/overview');
});

test('docs pages render canonical and social metadata', async ({ page }) => {
  await page.goto('/docs/langgraph/guides/streaming');

  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    'https://threadplane.ai/docs/langgraph/guides/streaming',
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Streaming — LangGraph Docs — Threadplane',
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    'content',
    'https://threadplane.ai/docs/langgraph/guides/streaming',
  );
  await expect(page.locator('meta[name="twitter:title"]')).toHaveAttribute(
    'content',
    'Streaming — LangGraph Docs — Threadplane',
  );
});

test('marketing pages render canonical and page-specific social URLs', async ({ page }) => {
  for (const route of ['/', '/langgraph', '/ag-ui', '/render', '/chat', '/pricing', '/contact', '/pilot-to-prod', '/solutions']) {
    await page.goto(route);
    const expectedUrl = route === '/' ? 'https://threadplane.ai' : `https://threadplane.ai${route}`;

    await expect(page.locator('link[rel="canonical"]'), `${route} canonical`).toHaveAttribute('href', expectedUrl);
    await expect(page.locator('meta[property="og:url"]'), `${route} og:url`).toHaveAttribute('content', expectedUrl);
  }
});

test('representative docs pages do not create page-level horizontal overflow', async ({ page }) => {
  const routes = [
    '/docs',
    '/docs/langgraph/getting-started/introduction',
    '/docs/langgraph/api/inject-agent',
    '/docs/chat/components/chat-tool-calls',
    '/docs/chat/a2ui/overview',
    '/docs/telemetry/guides/browser',
  ];
  const widths = [320, 375, 768, 1280];

  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });

    for (const route of routes) {
      await page.goto(route);

      // NOT documentElement.scrollWidth. global.css clips the body
      // (`overflow-x: clip`) precisely so overflow can never reach the layout
      // viewport, which means that number is pinned to the viewport width and
      // every assertion on it passed vacuously — confirmed by injecting a
      // 2000px-wide element and watching it stay put. Ask the question the
      // clip is hiding instead: does anything escape its own column? Content
      // inside a horizontal scroller (code blocks, wide tables) is exempt —
      // scrolling there is the intended containment.
      const escaped = await page.evaluate(() => {
        const column = document.querySelector('article') ?? document.querySelector('main');
        if (!column) return ['no column'];
        const box = column.getBoundingClientRect();
        const inScroller = (el: Element) => {
          let p = el.parentElement;
          while (p && p !== column) {
            const ox = getComputedStyle(p).overflowX;
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
            p = p.parentElement;
          }
          return false;
        };
        return [...column.querySelectorAll('*')]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.right > box.right + 1 && !inScroller(el);
          })
          .map((el) => `${el.tagName}.${String(el.className).slice(0, 40)}`);
      });

      expect(escaped, `${route} at ${width}px`).toEqual([]);
    }
  }
});

test('marketing pages gate the whitepaper PDFs behind the form', async ({ page }) => {
  // These pages used to link their PDF directly. Every direct-download escape
  // was removed on request, so the guide is now reachable only by submitting
  // the form -- the files stay served (see the next test), they are just not
  // linked. Asserted as absent so re-adding a link is a deliberate act.
  const gated: Record<string, string> = {
    '/ag-ui': '/whitepaper.pdf',
    '/langgraph': '/whitepapers/angular.pdf',
    '/render': '/whitepapers/render.pdf',
    '/chat': '/whitepapers/chat.pdf',
  };

  for (const [route, href] of Object.entries(gated)) {
    await page.goto(route);
    await expect(page.locator(`a[href="${href}"]`), `${route} still links ${href}`).toHaveCount(0);
  }
});

test('whitepaper PDFs are served as static downloads', async ({ request }) => {
  for (const href of [
    '/whitepaper.pdf',
    '/whitepapers/angular.pdf',
    '/whitepapers/render.pdf',
    '/whitepapers/chat.pdf',
  ]) {
    const response = await request.get(href);
    expect(response.ok(), `${href} responds successfully`).toBe(true);
    expect(response.headers()['content-type'], `${href} content type`).toContain('application/pdf');
  }
});
