import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';
import { SITE_ORIGIN } from '../src/lib/site-origin';
import {
  buildWhitepaperHtml,
  compileChapters,
  PAPERS,
  parsePaperArgs,
} from './whitepaper-document';

// npm run generate-whitepaper [-- --paper angular]
// Authored Markdown + type-checked examples; no network or model calls.
const website = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
);
const exampleDirectory = path.join(website, 'scripts/whitepapers/examples');
const examples = Object.fromEntries(
  readdirSync(exampleDirectory)
    .filter((file) => /\.tsx?$/.test(file))
    .map((file) => [
      file.replace(/\.tsx?$/, ''),
      readFileSync(path.join(exampleDirectory, file), 'utf8'),
    ])
);
const font = (file: string) =>
  readFileSync(path.join(website, 'src/app/card/fonts', file)).toString(
    'base64'
  );
const fonts = {
  regular: font('Archivo-Regular.ttf'),
  semibold: font('Archivo-SemiBold.ttf'),
  mono: font('JetBrainsMono-Bold.ttf'),
  logo: readFileSync(path.join(website, 'src/app/icon.svg')).toString('base64'),
};

async function main() {
  const selected = parsePaperArgs(process.argv.slice(2));
  const browser = await puppeteer.launch({ headless: true });
  try {
    for (const id of selected) {
      const paper = PAPERS[id];
      const source = readFileSync(
        path.join(website, 'content/whitepapers', `${id}.md`),
        'utf8'
      );
      const chapters = compileChapters(source, examples);
      const html = buildWhitepaperHtml(id, chapters, fonts);
      const htmlPath = path.join(website, 'public', paper.html);
      const pdfPath = path.join(website, 'public', paper.pdf);
      mkdirSync(path.dirname(pdfPath), { recursive: true });
      const page = await browser.newPage();
      // All fonts and styles are embedded. A network attempt is a build defect.
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        if (/^https?:/.test(request.url())) void request.abort();
        else void request.continue();
      });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        printBackground: true,
        preferCSSPageSize: true,
        displayHeaderFooter: true,
        headerTemplate: '<span></span>',
        footerTemplate: `<div style="width:100%;margin:0 18mm;font:9px Arial,sans-serif;color:#59616B;display:flex;justify-content:space-between"><span>${
          new URL(SITE_ORIGIN).hostname
        }</span><span class="pageNumber"></span></div>`,
      });
      writeFileSync(htmlPath, html);
      await page.close();
      const pdf = readFileSync(pdfPath, 'latin1');
      const pageCount = (pdf.match(/\/Type\s*\/Page[^s]/g) ?? []).length;
      console.log(
        `${id}: ${chapters.length} chapters, ${pageCount} pages → ${paper.pdf}`
      );
    }
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
