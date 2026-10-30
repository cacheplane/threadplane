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

function absolutize(line: string, origin: string): string {
  return line.replace(/\]\(\/(?!\/)/gu, `](${origin}/`);
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
    return inFence ? line : absolutize(line, opts.siteOrigin);
  });
  const body = splitProse(lines).join('\n').replace(/\n{3,}/gu, '\n\n').trim() + '\n';

  return { title, description, tags: normalizeTags(data['tags']), body };
}
