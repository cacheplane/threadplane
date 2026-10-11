import type { Post } from './blog';

const MARKDOWN_IMAGE = /!\[[^\]]*\]\(\s*<?([^\s)>]+)>?(?:\s+"[^"]*")?\s*\)/;
const IMG_TAG_SRC = /<img\b[^>]*\ssrc=["']([^"']+)["']/i;

const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  avif: 'image/avif',
};

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** The post's picture: frontmatter `image`, else its first Markdown image or `<img>`, whichever comes first. */
export function postImage(post: Post): string | undefined {
  if (post.frontmatter.image) return post.frontmatter.image;
  const md = MARKDOWN_IMAGE.exec(post.content);
  const tag = IMG_TAG_SRC.exec(post.content);
  if (md && (!tag || md.index < tag.index)) return md[1];
  return tag?.[1];
}

/** The picture as Media RSS, so readers and syncs don't fall back to the title-card og:image. */
function mediaContent(post: Post, origin: string): string {
  const image = postImage(post);
  if (!image) return '';
  const url = new URL(image, origin);
  const type = IMAGE_TYPES[url.pathname.split('.').pop()?.toLowerCase() ?? ''];
  return `
      <media:content url="${escapeXml(url.href)}" medium="image"${type ? ` type="${type}"` : ''} />`;
}

export function buildBlogRss(posts: Post[], origin: string): string {
  const items = posts
    .map((p) => {
      const url = `${origin}/blog/${p.slug}`;
      const d = new Date(p.frontmatter.date);
      const pubDate = Number.isNaN(d.getTime()) ? '' : d.toUTCString();
      return `    <item>
      <title><![CDATA[${p.frontmatter.title}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${p.frontmatter.description}]]></description>${mediaContent(p, origin)}
    </item>`;
    })
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" ?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/">
  <channel>
    <title>${escapeXml('Threadplane Blog')}</title>
    <link>${origin}/blog</link>
    <atom:link href="${origin}/blog/rss.xml" rel="self" type="application/rss+xml" />
    <description>${escapeXml('Writing on agent UI for Angular.')}</description>
    <language>en</language>
${items}
  </channel>
</rss>
`;
}
