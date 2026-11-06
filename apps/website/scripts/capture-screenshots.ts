/**
 * Capture product screenshots from the live Website workspace
 * for use in the marketing site's BrowserFrame placeholders.
 *
 * Captures the streaming docs workspace in each of its 4 modes (Run, Code,
 * Docs, API) at 2× DPR, then crops the workspace content well, optimizes
 * to WebP, and writes to apps/website/public/screenshots/.
 *
 * Usage:
 *   npx tsx apps/website/scripts/capture-screenshots.ts
 *
 * Optional flags:
 *   --url <url>    Override the Website workspace URL
 *   --keep-png     Keep the intermediate PNG files (for debugging)
 *
 * The script is idempotent — it overwrites existing files in
 * apps/website/public/screenshots/. The output WebP files are committed
 * to the repo so the marketing site can use them at build time without
 * needing this script to run.
 */
import { chromium, type Page } from 'playwright';
import sharp from 'sharp';
import { mkdir, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';

export const DEFAULT_WEBSITE_URL =
  'https://threadplane.ai/docs/angular/langgraph/guides/streaming?mode=run';
export const WORKSPACE_READY_SELECTOR =
  '[data-workspace-shell][data-hydrated="true"]';
export const WORKSPACE_CONTENT_SELECTOR = '[data-workspace-surface]';

export interface CaptureTarget {
  /** Output filename (without extension). */
  name: string;
  /** Workspace mode to switch to before capturing. */
  mode: 'Run' | 'Code' | 'Docs' | 'API';
  /**
   * Selector for the element to capture. If omitted, captures the workspace
   * content section (everything except the sidebar) at full size.
   */
  selector?: string;
  /** Additional wait after mode click before screenshotting (ms). */
  settleMs?: number;
}

export const CAPTURE_TARGETS: readonly CaptureTarget[] = [
  // Hero collage back frame + Stream FeatureBlock + Pilot "Build" block.
  // The "Run" mode shows the live chat surface — captures real product UI.
  { name: 'workspace-run', mode: 'Run', settleMs: 4000 },
  // Hero collage front frame replacement — Code mode shows the agent
  // source code in a tabbed code panel.
  { name: 'workspace-code', mode: 'Code', settleMs: 1500 },
  // Render FeatureBlock visual — Docs mode shows narrative documentation
  // (well-structured content, looks like rendered output).
  { name: 'workspace-docs', mode: 'Docs', settleMs: 1500 },
  // API mode shows the API reference renderer — useful alternative
  // for the Render block visual.
  { name: 'workspace-api', mode: 'API', settleMs: 1500 },
];

export interface CaptureArgs {
  url: string;
  keepPng: boolean;
}

export function parseCaptureArgs(
  args: readonly string[] = process.argv.slice(2)
): CaptureArgs {
  const out: CaptureArgs = { url: DEFAULT_WEBSITE_URL, keepPng: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--url' && i + 1 < args.length) {
      out.url = args[++i];
    } else if (args[i] === '--keep-png') {
      out.keepPng = true;
    }
  }
  return out;
}

export function modeButtonName(mode: CaptureTarget['mode']): RegExp {
  return new RegExp(`^${mode}(?:,|$)`);
}

export function workspaceModeSelector(mode: CaptureTarget['mode']): string {
  return `[data-workspace-shell][data-workspace-mode="${mode}"]`;
}

export function isMainModule(
  metaUrl: string,
  argvEntry: string | undefined = process.argv[1]
): boolean {
  return Boolean(argvEntry && metaUrl === pathToFileURL(argvEntry).href);
}

async function ensureDir(path: string): Promise<void> {
  if (!existsSync(path)) await mkdir(path, { recursive: true });
}

async function switchMode(page: Page, mode: CaptureTarget['mode']): Promise<void> {
  // The Website control plane exposes each mode as an accessible button.
  const button = page.getByRole('button', {
    name: modeButtonName(mode),
  });
  await button.waitFor({ state: 'visible', timeout: 10_000 });
  await button.click();
  await page
    .locator(workspaceModeSelector(mode))
    .waitFor({ state: 'visible', timeout: 15_000 });
}

async function captureOne(
  page: Page,
  target: CaptureTarget,
  outputDir: string,
  keepPng: boolean,
): Promise<{ png: string; webp: string }> {
  console.log(`  → switching to ${target.mode} mode`);
  await switchMode(page, target.mode);

  const settle = target.settleMs ?? 1500;
  console.log(`  → waiting ${settle}ms for content to settle`);
  await page.waitForTimeout(settle);

  // Capture the Website workspace content section (not the sidebar — we want the
  // mode content visible at the top, not the sidebar nav).
  const locator = target.selector
    ? page.locator(target.selector)
    : page.locator(WORKSPACE_CONTENT_SELECTOR);

  const pngPath = join(outputDir, `${target.name}.png`);
  const webpPath = join(outputDir, `${target.name}.webp`);

  console.log(`  → screenshotting → ${target.name}.png`);
  await locator.screenshot({ path: pngPath, type: 'png' });

  console.log(`  → optimizing → ${target.name}.webp`);
  await sharp(pngPath)
    .resize({ width: 1400, withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(webpPath);

  if (!keepPng) await unlink(pngPath);

  return { png: pngPath, webp: webpPath };
}

async function main(): Promise<void> {
  const args = parseCaptureArgs();
  const outputDir = join(process.cwd(), 'apps/website/public/screenshots');
  await ensureDir(outputDir);

  console.log(`Capturing Website workspace screenshots from: ${args.url}`);
  console.log(`Output: ${outputDir}\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  const page = await context.newPage();

  try {
    console.log(`Loading Website workspace at ${args.url}`);
    await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Wait for the Website workspace shell to hydrate.
    await page.waitForSelector(
      WORKSPACE_READY_SELECTOR,
      { timeout: 15_000 }
    );
    console.log('Website workspace hydrated ✓\n');

    for (const target of CAPTURE_TARGETS) {
      console.log(`Capturing: ${target.name}`);
      await captureOne(page, target, outputDir, args.keepPng);
      console.log('');
    }

    console.log('✓ All screenshots captured.');
  } finally {
    await browser.close();
  }
}

if (isMainModule(import.meta.url)) {
  void main().catch((err) => {
    console.error('Capture failed:', err);
    process.exit(1);
  });
}
