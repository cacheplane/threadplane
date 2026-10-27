import assert from 'node:assert/strict';

export const presentationSequence = [
  'Append',
  'Append task and table',
  'Append document',
  'Equal render',
  'Arrive definitions',
  'Finish',
  'Replace failed image',
  'Late old image error',
  'Fail current image',
  'New generation',
  'Remove React',
  'Append without React',
  'Mount React',
  'Remove Angular',
  'Append without Angular',
  'Mount Angular',
  'Dispose',
  'Try disposed',
];
export const parserKinds = [
  'autolink',
  'blockquote',
  'citation-reference',
  'code-block',
  'document',
  'emphasis',
  'heading',
  'html-block',
  'html-inline',
  'image',
  'inline-code',
  'link',
  'link-reference',
  'list',
  'list-item',
  'math-display',
  'math-inline',
  'paragraph',
  'soft-break',
  'strikethrough',
  'strong',
  'table',
  'table-cell',
  'table-row',
  'text',
  'thematic-break',
];

async function semantics(panel) {
  return panel.evaluate((root) => ({
    // Browser-visible text, not just textContent. Semantic descendants omit
    // framework wrappers, comments and decorative implementation attributes.
    text: root.innerText,
    headings: [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((n) => [
      n.tagName,
      n.innerText,
    ]),
    links: [...root.querySelectorAll('a')].map((n) => [
      n.innerText,
      n.getAttribute('href'),
    ]),
    images: [...root.querySelectorAll('img,[role=img]')].map((n) => [
      n.getAttribute('alt') ?? n.getAttribute('aria-label'),
      n.getAttribute('src'),
    ]),
    tasks: [...root.querySelectorAll('input')].map((n) => [
      n.checked,
      n.disabled,
      n.getAttribute('aria-label'),
    ]),
    citations: [...root.querySelectorAll('sup')].map((n) => [
      n.innerText,
      n.getAttribute('aria-label'),
    ]),
    tables: [...root.querySelectorAll('table')].map((n) => n.innerText),
    invalid: [
      ...root.querySelectorAll(
        'table > *,thead > *,tbody > *,tr > *,ul > *,ol > *'
      ),
    ]
      .filter(
        (n) =>
          !(
            {
              TABLE: ['THEAD', 'TBODY'],
              THEAD: ['TR'],
              TBODY: ['TR'],
              TR: ['TH', 'TD'],
              UL: ['LI'],
              OL: ['LI'],
            }[n.parentElement.tagName] ?? []
          ).includes(n.tagName)
      )
      .map((n) => n.tagName),
    unsafe: [...root.querySelectorAll('a[href],img[src]')]
      .map((n) => n.getAttribute('href') ?? n.getAttribute('src'))
      .filter((s) => /^(javascript|data|vbscript):/i.test(s)),
    literalHtml: root.querySelectorAll(
      'script,iframe,b[data-raw],div[data-raw]'
    ).length,
  }));
}

async function spacing(panel) {
  return panel
    .locator('p')
    .first()
    .evaluate((p) => {
      const style = getComputedStyle(p);
      const range = document.createRange();
      range.selectNodeContents(p);
      const lines = [...range.getClientRects()].map((r) => ({
        top: Math.round(r.top - p.getBoundingClientRect().top),
        width: Math.round(r.width),
      }));
      const char = (offset) => {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let text = walker.nextNode();
        while (text && offset >= text.textContent.length) {
          offset -= text.textContent.length;
          text = walker.nextNode();
        }
        if (!text) throw new Error('Missing expected paragraph character');
        const r = document.createRange();
        r.setStart(text, offset);
        r.setEnd(text, offset + 1);
        const b = r.getBoundingClientRect();
        return { x: b.x, y: b.y, width: b.width };
      };
      return {
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        text: p.innerText,
        lines,
        spacesWidth: char(8).x - char(5).x,
        softBreak: char(18).y > char(0).y,
        contained: p.scrollWidth <= p.clientWidth + 1,
      };
    });
}

export async function verifyPresentationBrowser(browser, url) {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 900 },
  });
  const problems = [],
    external = [],
    responses = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (['warning', 'error'].includes(message.type()))
      problems.push(message.text());
  });
  page.on('requestfailed', (request) =>
    problems.push('Request failed: ' + request.url())
  );
  page.on('response', (response) => {
    if (response.status() >= 400)
      problems.push('HTTP ' + response.status() + ': ' + response.url());
    responses.push(response.url());
  });
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== url) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const read = () => page.evaluate(() => window.__markdownPresentation());
  const panels = ['React', 'Angular'].map((name) =>
    page.getByRole('region', { name: name + ' native Markdown' })
  );
  let references, spacingEvidence;
  const removed = {};
  const observedKinds = new Set();
  try {
    await page.goto(url + '/presentation');
    await page.waitForFunction(
      () =>
        window.__markdownPresentation?.().ready &&
        window.__markdownPresentation().sameReference
    );
    assert.equal((await read()).commands, 0);
    for (const [index, action] of presentationSequence.entries()) {
      const before = await read();
      if (action.startsWith('Remove ')) {
        const framework = action.slice('Remove '.length);
        removed[framework] = await panels[
          framework === 'React' ? 0 : 1
        ].elementHandle();
      }
      await page.getByRole('button', { name: action, exact: true }).click();
      await page.waitForFunction(
        (step) =>
          window.__markdownPresentation().step === step &&
          !window.__markdownPresentation().busy &&
          window.__markdownPresentation().sameReference,
        index + 1
      );
      const evidence = await read();
      evidence.kinds.forEach((kind) => observedKinds.add(kind));
      assert.equal(evidence.retainedStable, true);
      assert.equal(evidence.stableRead, true);
      for (const framework of ['react', 'angular']) {
        assert.equal(
          evidence.subscriptions[framework].outstanding,
          evidence.mounted[framework] ? 1 : 0
        );
        assert.equal(
          evidence.subscriptions[framework].registrations -
            evidence.subscriptions[framework].cleanups,
          evidence.subscriptions[framework].outstanding
        );
        const acceptsUpdate = [
          'Append',
          'Append task and table',
          'Append document',
          'Arrive definitions',
          'Finish',
          'Replace failed image',
          'New generation',
          'Append without React',
          'Append without Angular',
        ].includes(action);
        assert.equal(
          evidence.subscriptions[framework].notifications -
            before.subscriptions[framework].notifications,
          acceptsUpdate && evidence.mounted[framework] ? 1 : 0,
          framework + ' notifications after ' + action
        );
        if (!before.mounted[framework] && !action.startsWith('Mount'))
          assert.equal(evidence.renders[framework], before.renders[framework]);
      }
      if (action.startsWith('Remove ') || action.startsWith('Mount ')) {
        const framework = action.split(' ')[1];
        assert.equal(
          await removed[framework].evaluate((node) => node.isConnected),
          false,
          'Removed view stays detached after ' + action
        );
        assert.equal(
          await panels[framework === 'React' ? 0 : 1].count(),
          action.startsWith('Mount ') ? 1 : 0
        );
      }
      if (
        [
          'Equal render',
          'Remove React',
          'Mount React',
          'Remove Angular',
          'Mount Angular',
          'Dispose',
          'Try disposed',
          'Late old image error',
          'Fail current image',
        ].includes(action)
      ) {
        assert.deepEqual(evidence.document, before.document);
        assert.equal(
          evidence.ownerUnchanged,
          true,
          action + ' preserves owner snapshot identity'
        );
      }
      if (action === 'Append') {
        references = await Promise.all(
          panels.map(async (panel) =>
            Promise.all(
              ['p', 'ul', 'table'].map((selector) =>
                panel.locator(selector).first().elementHandle()
              )
            )
          )
        );
        spacingEvidence = await Promise.all(panels.map(spacing));
        assert.deepEqual(
          spacingEvidence[1],
          spacingEvidence[0],
          'Angular/React actual whitespace and line layout parity'
        );
        assert.equal(spacingEvidence[0].whiteSpace, 'pre-wrap');
        assert.equal(spacingEvidence[0].overflowWrap, 'anywhere');
        assert.equal(spacingEvidence[0].softBreak, true);
        assert.equal(spacingEvidence[0].contained, true);
        assert.ok(
          spacingEvidence[0].spacesWidth > 10,
          'Multiple spaces remain visible'
        );
      }
      if (
        [
          'Append task and table',
          'Append document',
          'Equal render',
          'Arrive definitions',
          'Finish',
        ].includes(action)
      ) {
        for (const [i, panel] of panels.entries())
          for (const [j, selector] of ['p', 'ul', 'table'].entries())
            assert.equal(
              await panel
                .locator(selector)
                .first()
                .evaluate((node, prior) => node === prior, references[i][j]),
              true,
              action + ' preserves ' + selector
            );
      }
      if (action === 'Append task and table') {
        for (const panel of panels) {
          assert.equal(
            await panel
              .getByRole('checkbox', { name: 'Completed task' })
              .count(),
            1
          );
          assert.equal(await panel.locator('table').count(), 2);
        }
      }
      if (action === 'Append document') {
        for (const panel of panels) {
          await panel
            .locator('[role=img][aria-label="Replaceable image"]')
            .waitFor();
          assert.equal(
            await panel
              .getByRole('link', { name: 'Reference label', exact: true })
              .count(),
            0
          );
          assert.match(await panel.innerText(), /\[Reference label\]\[later\]/);
          assert.match(
            await panel.innerText(),
            /<div data-raw="block">literal block<\/div>/
          );
          assert.match(await panel.innerText(), /\$x\$/);
          assert.match(await panel.innerText(), /\\\(y\\\)/);
          assert.match(
            await panel.innerText(),
            /\[collapsed\]\[\], \[shortcut\]/
          );
          assert.deepEqual(
            await panel
              .locator('table')
              .nth(1)
              .locator('tbody td')
              .allTextContents(),
            ['fragment', 'arrives']
          );
          assert.equal(
            await panel
              .getByRole('checkbox', { name: 'Incomplete task' })
              .count(),
            1
          );
          assert.equal(
            await panel
              .getByRole('link', { name: 'Safe link', exact: true })
              .getAttribute('href'),
            '/safe'
          );
          assert.equal(
            await panel
              .getByRole('link', { name: 'Blocked link', exact: true })
              .count(),
            0
          );
          assert.match(await panel.innerText(), /Blocked link/);
          assert.equal(
            await panel
              .locator('sup[aria-label="Unresolved citation missing"]')
              .count(),
            1
          );
          assert.equal(
            await panel
              .getByRole('img', { name: 'Blocked image', exact: true })
              .count(),
            1
          );
        }
      }
      if (action === 'Arrive definitions' || action === 'Finish') {
        for (const panel of panels) {
          assert.equal(
            await panel
              .getByRole('link', { name: 'Reference label', exact: true })
              .getAttribute('href'),
            '/resolved'
          );
          assert.equal(
            await panel.locator('sup[aria-label="Citation 1"]').count(),
            1
          );
          for (const name of ['collapsed', 'shortcut'])
            assert.equal(
              await panel
                .getByRole('link', { name, exact: true })
                .getAttribute('href'),
              '/' + name
            );
          const blocks = await panel.locator('pre').allTextContents();
          assert.ok(blocks.includes('$$\nx+y\n$$'));
          assert.ok(blocks.includes('\\[x-y\\]'));
        }
      }
      if (action === 'Finish')
        assert.equal(evidence.document.phase, 'complete');
      if (
        [
          'Replace failed image',
          'Late old image error',
          'New generation',
        ].includes(action)
      ) {
        for (const panel of panels) {
          await panel.locator('img[alt="Replaceable image"]').waitFor();
          await page.waitForFunction(() =>
            [
              ...document.querySelectorAll('img[alt="Replaceable image"]'),
            ].every((image) => image.complete && image.naturalWidth > 0)
          );
        }
      }
      if (action === 'Fail current image')
        for (const panel of panels)
          await panel
            .locator('[role=img][aria-label="Replaceable image"]')
            .waitFor();
      if (action === 'New generation') {
        for (const handles of references)
          for (const handle of handles)
            assert.equal(
              await handle.evaluate((node) => node.isConnected),
              false
            );
        assert.equal(evidence.document.generation, 'native-2');
      }
      if (action === 'Try disposed') {
        assert.match(evidence.error, /disposed/);
        assert.deepEqual(evidence.subscriptions, before.subscriptions);
      }
      if (evidence.mounted.react && evidence.mounted.angular) {
        const [react, angular] = await Promise.all(panels.map(semantics));
        assert.deepEqual(
          angular,
          react,
          'Native semantic parity after ' + action
        );
        assert.deepEqual(
          react.invalid,
          [],
          'Native valid table/list structure'
        );
        assert.deepEqual(
          react.unsafe,
          [],
          'Unsafe destinations never reach attributes'
        );
        assert.equal(react.literalHtml, 0, 'HTML stays literal');
      }
    }
    assert.deepEqual(
      [...observedKinds].sort(),
      parserKinds,
      '26 real parser node kinds; hard-break is supplementary unit coverage only'
    );
    assert.ok(responses.some((url) => url.endsWith('/failure.png')));
    assert.ok(responses.some((url) => url.endsWith('/success.svg')));
    assert.deepEqual(problems, []);
    assert.deepEqual(external, []);
    return {
      controls: presentationSequence.length,
      parserKinds: [...observedKinds].sort(),
      supplementaryOnly: ['hard-break'],
      spacing: spacingEvidence,
      problems,
      external,
      ...(await read()),
    };
  } finally {
    await page.close();
  }
}
