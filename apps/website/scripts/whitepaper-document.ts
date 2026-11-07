import { marked } from 'marked';
import { FIELD_REPORT } from '../src/lib/field-report';
import { SITE_ORIGIN } from '../src/lib/site-origin';
import { renderDiagram } from './whitepapers/diagrams';
import { WHITEPAPERS } from '../src/lib/whitepapers';

export const PAPERS = WHITEPAPERS;
export type PaperId = keyof typeof PAPERS;
export interface Chapter {
  id: string;
  title: string;
  html: string;
}

export function parsePaperArgs(args: string[]): PaperId[] {
  let selected: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--rerender') continue; // All builds now render reviewed content.
    if (arg === '--paper') {
      if (!args[i + 1] || args[i + 1].startsWith('--'))
        throw new Error('--paper requires an ID');
      selected = args[++i];
    } else if (arg.startsWith('--paper='))
      selected = arg.slice('--paper='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (selected === undefined) return Object.keys(PAPERS) as PaperId[];
  if (!Object.hasOwn(PAPERS, selected))
    throw new Error(`Unknown paper: ${selected}`);
  return [selected as PaperId];
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Trusted, repository-authored Markdown only. Example source is included verbatim. */
export function compileChapters(
  markdown: string,
  examples: Record<string, string>
): Chapter[] {
  const expanded = markdown
    .replace(/<!-- example:([a-z-]+) -->/g, (_, name: string) => {
      if (!Object.hasOwn(examples, name))
        throw new Error(`Missing whitepaper example: ${name}`);
      return `\n\n\`\`\`typescript\n${examples[name].trim()}\n\`\`\`\n\n`;
    })
    .replace(
      /<!-- diagram:([a-z-]+) -->/g,
      (_, name: string) => `\n\n${renderDiagram(name)}\n\n`
    );
  const tokens = marked.lexer(expanded);
  const chapters: Chapter[] = [];
  let body: typeof tokens = [] as unknown as typeof tokens;
  body.links = tokens.links;
  const flush = () => {
    if (chapters.length)
      chapters[chapters.length - 1].html = marked.parser(body);
    body = [] as unknown as typeof tokens;
    body.links = tokens.links;
  };
  for (const token of tokens) {
    if (token.type === 'heading' && token.depth === 2) {
      flush();
      const id = token.text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      if (chapters.some((chapter) => chapter.id === id))
        throw new Error(`Duplicate chapter: ${id}`);
      chapters.push({ id, title: token.text, html: '' });
    } else {
      if (!chapters.length && token.type !== 'space')
        throw new Error('Whitepaper must begin with a chapter');
      body.push(token);
    }
  }
  flush();
  if (!chapters.length) throw new Error('Whitepaper has no chapters');
  return chapters;
}

export function buildWhitepaperHtml(
  id: PaperId,
  chapters: Chapter[],
  fonts: { regular: string; semibold: string; mono: string; logo: string }
): string {
  const paper = PAPERS[id];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(paper.title)} — Threadplane</title>
<style>
@font-face{font-family:Archivo;src:url(data:font/ttf;base64,${
    fonts.regular
  }) format('truetype');font-weight:400}
@font-face{font-family:Archivo;src:url(data:font/ttf;base64,${
    fonts.semibold
  }) format('truetype');font-weight:600}
@font-face{font-family:JetBrains;src:url(data:font/ttf;base64,${
    fonts.mono
  }) format('truetype');font-weight:400}
:root{color-scheme:light;--ink:#15253E;--text:#303740;--muted:#59616B;--line:#E5E5E5;--panel:#F2F2F0;--amber:#FFAF00}
*{box-sizing:border-box}html{background:#E5E5E5}body{margin:0;color:var(--text);font:14px/1.62 Archivo,Arial,sans-serif}
main{max-width:794px;margin:24px auto;background:white;padding:62px 68px}
h1,h2,h3,p,ul,ol,pre{margin:0}h1,h2,h3{color:var(--ink);font-weight:600;line-height:1.13;letter-spacing:-.035em}
h1{font-size:58px;max-width:560px;margin:56px 0 24px}h2{font-size:34px;margin-bottom:26px}h3{font-size:18px;margin:26px 0 10px;letter-spacing:-.02em}
p,ul,ol{margin:0 0 16px}ul,ol{padding-left:22px}li{padding-left:3px;margin:6px 0}a{color:var(--ink);text-decoration-color:#ABAFB3;text-underline-offset:3px;overflow-wrap:anywhere}
strong{font-weight:600}code{font:11px/1.6 JetBrains,monospace;overflow-wrap:anywhere}p code,li code{background:var(--panel);padding:1px 3px;border-radius:3px}
pre{font:12px/1.5 JetBrains,monospace;background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:18px;margin:20px 0;white-space:pre-wrap;overflow-wrap:anywhere;break-inside:avoid}
pre code{font-size:12px;line-height:1.5;white-space:pre-wrap}blockquote{margin:22px 0;padding:18px 20px;background:var(--panel);border-left:3px solid var(--amber)}blockquote p:last-child{margin-bottom:0}
.cover{min-height:870px;display:flex;flex-direction:column}.brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:600;color:var(--ink);letter-spacing:-.04em}.brand img{width:28px;height:28px}
.cover-panel{background:var(--panel);border-radius:18px;padding:32px;margin-top:42px;min-height:490px;position:relative}.cover-panel:before{content:'';display:block;width:48px;height:5px;background:var(--amber);border-radius:4px}
.subtitle{font-size:21px;line-height:1.45;color:var(--muted);max-width:440px}.cover-details{margin-top:auto;padding-top:48px;font-size:12px;color:var(--muted)}.cover-details p{margin-bottom:6px}
.contents{padding-top:16px;min-height:800px}.contents>p{color:var(--muted)}.contents ol{list-style:none;padding:0;margin-top:28px;counter-reset:chapter}.contents li{counter-increment:chapter;border-top:1px solid var(--line);margin:0;padding:12px 0;display:flex;gap:20px;font-size:17px;line-height:1.4}.contents li:before{content:counter(chapter,decimal-leading-zero);font-size:12px;color:var(--muted);min-width:22px;padding-top:3px}.contents a{text-decoration:none}.scope{margin-top:28px;padding:20px;background:var(--panel);border-radius:10px;font-size:12px}.scope p:last-child{margin:0}
.chapter{padding-top:16px;margin-top:60px}.chapter h2{max-width:540px}.chapter p,.chapter li{orphans:3;widows:3}h2,h3{break-after:avoid}
table{border-collapse:collapse;width:100%;table-layout:fixed;font-size:12px;line-height:1.5;margin:22px 0;break-inside:avoid}th,td{text-align:left;vertical-align:top;padding:10px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{background:var(--panel);color:var(--ink);font-weight:600}thead{display:table-header-group}tr{break-inside:avoid}table code{font-size:10px}
.flow-diagram{margin:26px 0;padding:18px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line);break-inside:avoid}.diagram-title{color:var(--ink);font-weight:600;font-size:17px;margin:0 0 10px}.diagram-network{display:block;width:100%;height:auto;font-family:Archivo,Arial,sans-serif;fill:var(--ink)}figcaption{font-size:12px;line-height:1.5;color:var(--muted);margin-top:10px}.diagram-mobile{display:none}
@media(max-width:600px){main{margin:0;padding:32px 22px}.cover{min-height:700px}.cover-panel{padding:24px;min-height:400px}h1{font-size:43px}.subtitle{font-size:19px}.contents{min-height:auto}.chapter{margin-top:64px}h2{font-size:29px}pre{padding:12px}}
@media screen and (max-width:600px){.diagram-network{display:none}.diagram-mobile{display:block;font-size:13px}.cover-panel h1{font-size:clamp(32px,8vw,43px)}table{font-size:11px}th,td{padding:7px}}
@media print{@page{size:A4;margin:18mm 18mm 20mm}html{background:white}body{font-size:14px;line-height:1.5}main{max-width:none;margin:0;padding:0}.cover{min-height:254mm;break-after:page}.cover-panel{min-height:148mm;margin-top:12mm}.cover-details{padding-top:12mm}.contents{min-height:0;break-after:page;padding:0}.chapter{padding:0;margin:34px 0 0}.contents+.chapter{margin-top:0}.chapter h2{font-size:31px}h1{font-size:53px}.contents li{padding:10px 0}a{text-decoration-thickness:1px}pre{padding:15px;margin:18px 0}h3{margin-top:22px}p,ul,ol{margin-bottom:14px}.chapter p{break-inside:avoid}}
</style></head><body><main>
<section class="cover" aria-label="Cover"><div class="brand"><img src="data:image/svg+xml;base64,${
    fonts.logo
  }" alt="" />Threadplane</div>
<div class="cover-panel"><h1>${escapeHtml(
    paper.title
  )}</h1><p class="subtitle">${escapeHtml(paper.subtitle)}</p></div>
<div class="cover-details"><p>${escapeHtml(
    FIELD_REPORT.kicker
  )}</p><p>Engineering guide · ${
    FIELD_REPORT.year
  } · Research reviewed November 7</p><a href="${SITE_ORIGIN}">${
    new URL(SITE_ORIGIN).hostname
  }</a></div></section>
<nav class="contents" aria-label="Contents"><h2>Inside this guide</h2><p>Practical boundaries, current APIs, and decisions to make before you ship.</p><ol>${chapters
    .map(
      (chapter) =>
        `<li><a href="#${chapter.id}">${escapeHtml(chapter.title)}</a></li>`
    )
    .join('')}</ol>
<div class="scope"><p><strong>For senior engineers and technical leaders</strong></p><p>Framework-neutral architecture, with Angular and React examples. Published Angular adapters and native source-build bindings are distinct profiles; each example identifies its scope. Native packages remain private and are not npm installation instructions.</p><p>Research and repository API review: November 7, 2026. Model catalogs and upstream specifications are dated observations, not a promise of Threadplane support. Threadplane is free and open source; you own your backend, data and deployment.</p></div></nav>
${chapters
  .map(
    (chapter) =>
      `<section class="chapter" id="${chapter.id}"><h2>${escapeHtml(
        chapter.title
      )}</h2>${chapter.html}</section>`
  )
  .join('\n')}
</main></body></html>`;
}
