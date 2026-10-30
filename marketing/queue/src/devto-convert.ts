import matter from 'gray-matter';

export interface DevtoConversion {
  title: string;
  description: string;
  tags: string[];
  body: string;
}

const FENCE = /^\s*(```|~~~)/u;
const CALLOUT_OPEN = /^\s*<Callout\b([^>]*)>(.*)$/u;
const CALLOUT_CLOSE = /^(.*?)<\/Callout>\s*$/u;
// Markdown constructs that are not a plain paragraph line.
const NOT_PROSE = /^(\s|#|[-*+]\s|\d+[.)]\s|\||>|<|!\[[^\]]*\]\([^)]*\)\s*$)/u;

function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const tags: string[] = [];
  for (const item of list) {
    const tag = String(item).toLowerCase().replace(/[^a-z0-9]/gu, '');
    if (tag && !tags.includes(tag)) tags.push(tag);
  }
  return tags.slice(0, 4);
}

/** Rewrites `<Callout>` blocks as blockquotes; everything inside code fences is left alone. */
function convertCallouts(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let inCallout = false;
  for (const rawLine of lines) {
    let line = rawLine;
    if (inCallout && FENCE.test(line)) {
      throw new Error('code fence inside <Callout> is not supported; move it out of the callout');
    }
    if (!inCallout && FENCE.test(line)) inFence = !inFence;
    if (inFence || FENCE.test(line)) {
      out.push(line);
      continue;
    }
    if (!inCallout) {
      const open = CALLOUT_OPEN.exec(line);
      if (!open) {
        out.push(line);
        continue;
      }
      const title = /\btitle="([^"]*)"/u.exec(open[1])?.[1];
      if (title) out.push(`> **${title}**`, '>');
      inCallout = true;
      line = open[2];
    }
    const close = CALLOUT_CLOSE.exec(line);
    const content = (close ? close[1] : line).trim();
    if (content) out.push(`> ${content}`);
    if (close) inCallout = false;
  }
  if (inCallout) throw new Error('unclosed <Callout>');
  return out;
}

function assertNoUnknownComponents(lines: string[]): void {
  let inFence = false;
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const bare = line.replace(/`[^`]*`/gu, '');
    const component = /<([A-Z][A-Za-z0-9]*)/u.exec(bare)?.[1];
    if (component) throw new Error(`unsupported component <${component}>`);
  }
}

/** Appends the dev.to UTM trio to a threadplane.ai URL, merging with any query and keeping the #fragment. */
function withUtm(url: string, slug: string): string {
  const hashAt = url.indexOf('#');
  const fragment = hashAt === -1 ? '' : url.slice(hashAt);
  const noHash = hashAt === -1 ? url : url.slice(0, hashAt);
  const queryAt = noHash.indexOf('?');
  const base = queryAt === -1 ? noHash : noHash.slice(0, queryAt);
  const params = new URLSearchParams(queryAt === -1 ? '' : noHash.slice(queryAt + 1));
  params.set('utm_source', 'devto');
  params.set('utm_medium', 'social');
  params.set('utm_campaign', slug);
  return `${base}?${params.toString()}${fragment}`;
}

function rewriteUrl(url: string, origin: string, slug: string, utm: boolean): string {
  const absolute = /^\/(?!\/)/u.test(url) ? `${origin}${url}` : url;
  const ours = absolute === origin || absolute.startsWith(`${origin}/`) || absolute.startsWith(`${origin}?`) || absolute.startsWith(`${origin}#`);
  return utm && ours ? withUtm(absolute, slug) : absolute;
}

/** Rewrites only the text outside inline code spans (any backtick-run length). */
function absolutize(line: string, origin: string, slug: string): string {
  return line
    .split(/(`+)([\s\S]*?[^`])\1(?!`)/u)
    .map((part, i, parts) => {
      // split() with two groups yields [text, ticks, code, text, ticks, code, ...].
      if (i % 3 === 0) return rewriteSegment(part, origin, slug);
      if (i % 3 === 1) return part;
      return part + parts[i - 1];
    })
    .join('');
}

function rewriteSegment(line: string, origin: string, slug: string): string {
  return line
    .replace(/(!?)\[([^\]]*)\]\(([^)\s]+)([^)]*)\)/gu, (_m, bang: string, text: string, url: string, rest: string) =>
      `${bang}[${text}](${rewriteUrl(url, origin, slug, bang === '')}${rest})`
    )
    .replace(/\b(src|href)="([^"]*)"/gu, (_m, attr: string, url: string) =>
      `${attr}="${rewriteUrl(url, origin, slug, attr === 'href')}"`
    );
}

/** dev.to renders soft line breaks as one paragraph, so each prose line gets its own paragraph. */
function splitProse(lines: string[]): string[] {
  const out: string[] = [];
  let inFence = false;
  let prev = 'blank' as 'blank' | 'prose' | 'other';
  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      out.push(line);
      prev = 'other';
      continue;
    }
    if (inFence) {
      out.push(line);
      continue;
    }
    if (line.trim() === '') {
      out.push(line);
      prev = 'blank';
      continue;
    }
    // A bare line directly under a list/table/quote is a lazy continuation of it.
    const prose: boolean = !NOT_PROSE.test(line) && prev !== 'other';
    if (prose && prev === 'prose') out.push('');
    out.push(line);
    prev = prose ? 'prose' : 'other';
  }
  return out;
}

export function convertMdxForDevto(
  mdx: string,
  opts: { siteOrigin: 'https://threadplane.ai'; slug: string }
): DevtoConversion {
  const { data, content } = matter(mdx);
  const title = data['title'];
  if (typeof title !== 'string' || !title) throw new Error('frontmatter title is required');
  const description = typeof data['description'] === 'string' ? data['description'] : '';

  let lines = content.replace(/\r\n/gu, '\n').split('\n');
  lines = convertCallouts(lines);
  assertNoUnknownComponents(lines);
  let inFence = false;
  lines = lines.map((line) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return line;
    }
    return inFence ? line : absolutize(line, opts.siteOrigin, opts.slug);
  });
  const body = splitProse(lines).join('\n').replace(/\n{3,}/gu, '\n\n').trim() + '\n';

  return { title, description, tags: normalizeTags(data['tags']), body };
}
