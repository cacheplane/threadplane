/** Read-only production-browser audit. A failed assertion is never rerun until green. */
import { spawn, type ChildProcess } from 'node:child_process';
import { stat, symlink } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join, resolve } from 'node:path';
import { chromium, expect, type Locator, type Page } from '@playwright/test';
import {
  DOCS_AUDIT_ROUTES,
  geometryIssues,
  navigationIssue,
  requestDisposition,
} from './docs-audit-checks';
import { redactDiagnostic, requireDocsOrigin } from './docs-deployment';
import { forwardProtectedDocsRequest } from './docs-protected-request';
import { writeDocsAuditEvidence } from './docs-audit-evidence';
import {
  discoverDiagramRoutes,
  type DiagramRouteInventory,
} from './docs-diagram-inventory';

const root = resolve(__dirname, '../../..');
const output = resolve(
  root,
  process.env['DOCS_AUDIT_OUTPUT'] ?? 'dist/docs-audit/local'
);
const secret = process.env['VERCEL_AUTOMATION_BYPASS_SECRET'] ?? '';
const clean = (value: unknown) =>
  redactDiagnostic(value instanceof Error ? value.message : String(value), [
    secret,
  ]);
const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function measureDiagram(region: Locator) {
  const snapshot = await region.evaluate((element) => {
    const svg = element.querySelector('svg');
    const canvas = svg ?? element.querySelector('.tp-lesson-diagram');
    if (!canvas) throw new Error('Diagram canvas missing');
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const nodeSelector = svg
      ? '.tp-diagram-node'
      : '.tp-diagram-card, .tp-sequence-event';
    const nodeElements = [...canvas.querySelectorAll(nodeSelector)];
    const texts = [
      ...canvas.querySelectorAll(
        svg
          ? 'text'
          : '.tp-diagram-card > strong, .tp-diagram-card > small, .tp-sequence-event > strong, .tp-sequence-event > small, .tp-sequence-route, .tp-state-transitions dt, .tp-state-transitions dd, .tp-erd-relations p'
      ),
    ];
    const normalized = (value: string) => value.replace(/["']/g, '').trim();
    const fontsLoaded =
      texts.length > 0 &&
      texts.every((text) => {
        const style = getComputedStyle(text);
        const family = style.fontFamily.split(',')[0];
        return (
          [...document.fonts].some(
            (font) =>
              normalized(font.family) === normalized(family) &&
              font.status === 'loaded'
          ) &&
          document.fonts.check(
            `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${family}`,
            text.textContent ?? ''
          )
        );
      });
    return {
      viewportWidth: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      canvas: box(canvas),
      fontsLoaded,
      nodes: nodeElements.map((node, i) => {
        const shape = svg ? node.querySelector('rect') : node;
        if (!shape) throw new Error('Diagram node shape missing');
        return { id: String(i), box: box(shape) };
      }),
      texts: texts.flatMap((text) =>
        [
          ...(text.querySelectorAll('tspan').length
            ? text.querySelectorAll('tspan')
            : [text]),
        ].map((line) => {
          const node = line.closest(nodeSelector);
          return {
            text: line.textContent ?? '',
            box: box(line),
            node:
              node && nodeElements.includes(node)
                ? String(nodeElements.indexOf(node))
                : undefined,
          };
        })
      ),
    };
  });
  expect(geometryIssues(snapshot)).toEqual([]);
}

async function checkDiagram(page: Page, figure: Locator) {
  const description = await figure.locator('details p').textContent();
  expect(description?.trim().length).toBeGreaterThan(20);
  const region = figure.getByRole('region').first();
  await expect(region).toHaveAttribute('tabindex', '0');
  await measureDiagram(region);
  const overflow = await region.evaluate(
    (el) => el.scrollWidth - el.clientWidth
  );
  if (overflow > 1) {
    await region.focus();
    await page.keyboard.press('ArrowRight');
    await expect
      .poll(() => region.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    await region.evaluate((el) => {
      el.scrollLeft = 0;
    });
  }
  const trigger = figure.getByRole('button', { name: /^Expand diagram:/ });
  await trigger.focus();
  await page.keyboard.press('Enter');
  const dialog = figure.locator('dialog');
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', {
    name: 'Close diagram',
    exact: true,
  });
  await expect(close).toBeFocused();
  await expect(dialog.locator('details p')).toHaveText(description ?? '');
  await measureDiagram(dialog.getByRole('region'));
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.locator('summary')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(dialog).toBeVisible();
  const bounds = await close.boundingBox();
  const viewport = page.viewportSize();
  expect(
    bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      viewport &&
      bounds.x + bounds.width <= viewport.width
  ).toBeTruthy();
  const ids = await page
    .locator('[id]')
    .evaluateAll((els) => els.map((el) => el.id));
  expect(new Set(ids).size).toBe(ids.length);
  await close.click();
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
}

async function checkIndependentScroll(page: Page) {
  const nav = page.locator(
    '[data-workspace-desktop-navigation] [data-control-plane-pane]'
  );
  const article = page.locator('.docs-workspace-article').first();
  await nav.evaluate((el) => {
    el.scrollTop = 0;
  });
  await article.evaluate((el) => {
    el.scrollTop = 0;
  });
  const initialWindow = await page.evaluate(() => window.scrollY);
  await nav.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => nav.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await article.evaluate((el) => el.scrollTop)).toBe(0);
  const navTop = await nav.evaluate((el) => el.scrollTop);
  await article.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => article.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await nav.evaluate((el) => el.scrollTop)).toBe(navTop);
  expect(await page.evaluate(() => window.scrollY)).toBe(initialWindow);
  await nav.locator('a:visible').last().focus();
  const beforeKey = await article.evaluate((el) => el.scrollTop);
  await page.keyboard.press('Home');
  await expect.poll(() => nav.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await article.evaluate((el) => el.scrollTop)).toBe(beforeKey);
  await article
    .getByRole('button', { name: /^Expand diagram:/ })
    .last()
    .focus();
  await page.keyboard.press('Home');
  await expect.poll(() => article.evaluate((el) => el.scrollTop)).toBe(0);
  expect(await nav.evaluate((el) => el.scrollTop)).toBe(0);
}

async function checkMedia(page: Page, media: Locator) {
  const video = media.locator('video');
  await expect(video).toHaveAttribute('controls', '');
  await expect(video).toHaveAttribute('playsinline', '');
  await expect(video).toHaveAttribute('preload', 'none');
  await expect(video).not.toHaveAttribute('autoplay', '');
  await expect(video.locator('track[kind="captions"]')).toHaveCount(1);
  const captions = await video
    .locator('track[kind="captions"]')
    .getAttribute('src');
  const poster = await video.getAttribute('poster');
  const capture = await media
    .getByRole('link', { name: 'Capture details' })
    .getAttribute('href');
  const transcript = media.locator('[data-docs-demo-transcript]');
  await transcript.locator('summary').click();
  const text = await transcript
    .getByRole('link', { name: 'Download the text walkthrough' })
    .getAttribute('href');
  if (!captions || !poster || !capture || !text)
    throw new Error('Documentation media asset link missing');
  const assets = await page.evaluate(
    async ({ captions, poster, capture, text }) => {
      const read = async (src: string) => {
        const response = await fetch(src, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error(`Media asset returned HTTP ${response.status}`);
        return response.text();
      };
      const [vtt, provenance, walkthrough] = await Promise.all([
        read(captions),
        read(capture),
        read(text),
      ]);
      const image = new Image();
      image.src = poster;
      await Promise.race([
        image.decode(),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Media poster decode timed out')),
            10000
          )
        ),
      ]);
      return {
        vtt,
        capture: JSON.parse(provenance),
        walkthrough,
        posterWidth: image.naturalWidth,
      };
    },
    { captions, poster, capture, text }
  );
  expect(assets.vtt.startsWith('WEBVTT')).toBe(true);
  expect(assets.capture.demo).toBe(
    await media.getAttribute('data-docs-demo-video')
  );
  expect(assets.capture.frontend).toBe(
    await media.getAttribute('data-frontend')
  );
  expect(assets.capture.sourceRevision).toMatch(/^[a-f0-9]{40}$/);
  expect(assets.walkthrough.length).toBeGreaterThan(80);
  expect(assets.posterWidth).toBeGreaterThan(0);
  await expect(media.locator('[data-docs-demo-provenance]')).not.toHaveText('');
  expect((await transcript.textContent())?.length).toBeGreaterThan(80);
  // The recordings are silent; muting avoids browser autoplay policy without changing the page contract.
  await video.evaluate(async (element) => {
    const player = element as HTMLVideoElement;
    player.muted = true;
    await Promise.race([
      player.play(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Media playback timed out')), 10000)
      ),
    ]);
  });
  await expect
    .poll(() =>
      video.evaluate((element) => (element as HTMLVideoElement).currentTime)
    )
    .toBeGreaterThan(0.2);
  const playback = await video.evaluate((element) => {
    const player = element as HTMLVideoElement;
    player.pause();
    return {
      error: player.error?.code ?? null,
      ready: player.readyState,
      width: player.videoWidth,
      duration: player.duration,
    };
  });
  expect(playback.error).toBeNull();
  expect(playback.ready).toBeGreaterThanOrEqual(2);
  expect(playback.width).toBeGreaterThan(0);
  expect(playback.duration).toBeGreaterThan(0.2);
}

async function main() {
  const startedAt = new Date().toISOString();
  const results: {
    route: string;
    width: number;
    passed: boolean;
    error?: string;
  }[] = [];
  const events: { event: string; value: string }[] = [];
  let origin: string | undefined;
  let fatalError: string | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let server: ChildProcess | undefined;
  let serverLog = '';
  let inventory: DiagramRouteInventory[] = [];
  let activeTarget: { route: string; width: number } | undefined;
  let targets: readonly {
    path: string;
    kinds?: readonly string[];
    video?: boolean;
    diagrams?: readonly string[];
  }[] = [];
  const succeeded = () =>
    !fatalError &&
    targets.length > 0 &&
    results.length === targets.length * 2 &&
    results.every((result) => result.passed);
  // Deliberately retain sanitized metadata only, never request headers/bodies,
  // storage or Playwright HAR/trace files containing the deployment bypass.
  const checkpoint = (finished = false) =>
    writeDocsAuditEvidence(
      output,
      {
        passed: finished && succeeded(),
        status: finished ? 'finished' : activeTarget ? 'running' : 'started',
        origin,
        expectedRevision: process.env['DOCS_DEPLOYMENT_REVISION'],
        startedAt,
        finishedAt: finished ? new Date().toISOString() : undefined,
        fatalError,
        activeTarget,
        inventory,
        results,
      },
      events,
      serverLog
    );
  await checkpoint();
  try {
    if (process.env['DOCS_AUDIT_ORIGIN'])
      origin = requireDocsOrigin(process.env['DOCS_AUDIT_ORIGIN']);
    inventory = discoverDiagramRoutes(root);
    const byRoute = new Map(
      DOCS_AUDIT_ROUTES.map((target) => [
        target.path,
        { ...target, diagrams: undefined as readonly string[] | undefined },
      ])
    );
    for (const target of inventory)
      byRoute.set(target.path, { ...byRoute.get(target.path), ...target });
    targets = [...byRoute.values()];
    if (!origin) {
      const build = join(root, 'dist/apps/website');
      await stat(join(build, '.next/BUILD_ID'));
      try {
        await stat(join(build, 'content'));
      } catch {
        await symlink(
          join(root, 'apps/website/content'),
          join(build, 'content')
        );
      }
      const reservation = createServer();
      await new Promise<void>((done, fail) => {
        reservation.once('error', fail);
        reservation.listen(0, '127.0.0.1', done);
      });
      const address = reservation.address();
      if (!address || typeof address === 'string')
        throw new Error('Unable to reserve local audit port');
      await new Promise<void>((done, fail) =>
        reservation.close((error) => (error ? fail(error) : done()))
      );
      origin = `http://127.0.0.1:${address.port}`;
      server = spawn(
        process.execPath,
        [
          join(root, 'node_modules/nx/bin/nx.js'),
          'run',
          'website:serve:production',
          '--hostname=127.0.0.1',
          `--port=${address.port}`,
          '--skip-nx-cache',
        ],
        {
          cwd: root,
          env: {
            ...process.env,
            GROWTH_FORM_POLICY: 'growth_v1',
            NX_DAEMON: 'false',
            NX_ISOLATE_PLUGINS: 'false',
            NX_NO_CLOUD: 'true',
          },
          stdio: ['ignore', 'pipe', 'pipe'],
        }
      );
      let startupError: Error | undefined;
      server.once('error', (error) => {
        startupError = error;
      });
      for (const stream of [server.stdout, server.stderr])
        stream?.on('data', (data) => {
          serverLog = clean(serverLog + String(data)).slice(-30000);
        });
      let ready = false;
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline) {
        if (startupError || server.exitCode !== null)
          throw new Error(
            `Production server failed: ${startupError?.message ?? serverLog}`
          );
        if (serverLog.includes('Ready in')) {
          try {
            const response = await fetch(`${origin}/api/docs-revision`, {
              signal: AbortSignal.timeout(1000),
              redirect: 'error',
            });
            if (response.ok) {
              ready = true;
              break;
            }
          } catch {
            /* The owned server may still be binding or loading its config. */
          }
        }
        await delay(250);
      }
      if (!ready) throw new Error('Production server readiness timed out');
    }
    const auditedOrigin = origin;
    browser = await chromium.launch();
    for (const width of [1440, 320]) {
      const context = await browser.newContext({
        viewport: { width, height: 720 },
        serviceWorkers: 'block',
        reducedMotion: 'reduce',
      });
      // esbuild's named callbacks may reference this helper after Playwright serializes them.
      await context.addInitScript({
        content: 'window.__name = (value) => value;',
      });
      const errors: string[] = [];
      await context.route('**/*', async (route) => {
        const request = route.request();
        const requestOrigin = new URL(request.url()).origin;
        if (request.isNavigationRequest() && request.frame().parentFrame()) {
          events.push({
            event: 'runtime-not-exercised',
            value: clean(request.url()),
          });
          return route.fulfill({
            status: 200,
            contentType: 'text/html',
            body: '<!doctype html><html lang="en"><title>Runtime outside documentation audit</title><body></body></html>',
          });
        }
        if (request.isNavigationRequest() && requestOrigin !== auditedOrigin) {
          errors.push(
            navigationIssue(auditedOrigin, request.url()) ??
              'Unexpected cross-origin navigation'
          );
          return route.abort();
        }
        const disposition = requestDisposition(
          request.method(),
          request.url(),
          auditedOrigin
        );
        if (disposition !== 'allow') {
          events.push({
            event: `blocked-${disposition}`,
            value: clean(`${request.method()} ${request.url()}`),
          });
          if (disposition === 'analytics')
            return route.fulfill({ status: 204, body: '' });
          errors.push(clean(`Unexpected ${request.method()} ${request.url()}`));
          return route.abort();
        }
        // Never forward the protected deployment's bypass to another origin.
        const headers = { ...request.headers() };
        delete headers['x-vercel-protection-bypass'];
        if (
          secret &&
          requestOrigin === process.env['DOCS_AUDIT_BYPASS_ORIGIN']
        ) {
          try {
            return await forwardProtectedDocsRequest(route, secret);
          } catch (error) {
            errors.push(clean(error));
            return route.abort();
          }
        }
        return route.continue({ headers });
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', (error) => errors.push(clean(error)));
      page.on('response', (response) => {
        if (response.status() >= 400)
          events.push({
            event: 'http-error',
            value: clean(`${response.status()} ${response.url()}`),
          });
      });
      for (const [index, target] of targets.entries()) {
        errors.length = 0;
        try {
          events.push({ event: 'navigate', value: `${width} ${target.path}` });
          activeTarget = { route: target.path, width };
          await checkpoint();
          const response = await page.goto(auditedOrigin + target.path, {
            waitUntil: 'load',
            timeout: 30000,
          });
          const redirected = navigationIssue(auditedOrigin, page.url());
          if (redirected) throw new Error(redirected);
          expect(response?.ok()).toBe(true);
          await expect(page.locator('[data-workspace-shell]')).toHaveAttribute(
            'data-hydrated',
            'true'
          );
          await expect(page.locator('article').first()).toBeVisible();
          await page.evaluate(() => document.fonts.ready);
          if (target.path.includes('frontend=react'))
            await expect(page.getByLabel('Example UI')).toHaveValue('react');
          const actualKinds = await page
            .locator('figure[data-docs-diagram][data-diagram-kind]')
            .evaluateAll((els) =>
              els.map((el) => el.getAttribute('data-diagram-kind'))
            );
          for (const kind of target.kinds ?? [])
            expect(actualKinds).toContain(kind);
          const figures = page.locator('article figure[data-docs-diagram]');
          if (target.diagrams)
            await expect(figures).toHaveCount(target.diagrams.length);
          for (let diagram = 0; diagram < (await figures.count()); diagram++)
            await checkDiagram(page, figures.nth(diagram));
          const media = page.locator('article [data-docs-demo-video]');
          expect(await media.count()).toBeLessThanOrEqual(1);
          if (target.video) {
            await expect(media).toHaveCount(1);
            await expect(media).toHaveAttribute(
              'data-frontend',
              target.path.includes('frontend=react') ? 'react' : 'angular'
            );
            await checkMedia(page, media);
          }
          if (width === 1440) {
            const nav = page.locator('[data-workspace-desktop-navigation]');
            const last = nav.locator('.docs-sidebar-section').last();
            await expect(last).toContainText('Migrations');
            await expect(last.getByRole('button').first()).toHaveAttribute(
              'aria-expanded',
              'false'
            );
            if (index === 1) await checkIndependentScroll(page);
          }
          const size = await page.evaluate(() => ({
            actual: document.documentElement.scrollWidth,
            expected: innerWidth,
          }));
          expect(size.actual).toBeLessThanOrEqual(size.expected + 1);
          expect(errors).toEqual([]);
          results.push({ route: target.path, width, passed: true });
        } catch (error) {
          const message = clean(error);
          results.push({
            route: target.path,
            width,
            passed: false,
            error: message,
          });
          await checkpoint();
          await page
            .screenshot({
              path: join(output, `${width}-${index}-failure.png`),
              fullPage: true,
            })
            .catch(() => undefined);
          console.error(`${target.path} (${width}px): ${message}`);
        }
        activeTarget = undefined;
        await checkpoint();
        if (results.filter((result) => !result.passed).length >= 5)
          throw new Error(
            'Documentation audit stopped after five failures; inspect report.json and screenshots'
          );
      }
      await context.close();
    }
  } catch (error) {
    fatalError = clean(error);
    console.error(fatalError);
  } finally {
    await checkpoint(true);
    await browser?.close();
    if (server && server.exitCode === null) {
      const owned = server;
      const exited = new Promise<void>((done) =>
        owned.once('exit', () => done())
      );
      owned.kill('SIGTERM');
      await Promise.race([exited, delay(3000)]);
      if (owned.exitCode === null) owned.kill('SIGKILL');
    }
    await checkpoint(true);
    console.log(
      `Documentation audit: ${
        results.filter((result) => result.passed).length
      }/${targets.length * 2} page/viewports passed; ${inventory.reduce(
        (total, target) => total + target.diagrams.length,
        0
      )} authored diagram placements`
    );
    if (!succeeded()) process.exitCode = 1;
  }
}

void main().catch((error) => {
  console.error(clean(error));
  process.exitCode = 1;
});
