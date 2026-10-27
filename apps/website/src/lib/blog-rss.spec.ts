// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { Post } from './blog';
import { buildBlogRss, postImage } from './blog-rss';

const post = (content: string, extra: Partial<Post['frontmatter']> = {}): Post => ({
  slug: 'threadplane-0-3-0',
  date: '2026-10-07',
  filename: '2026-10-07-threadplane-0-3-0.mdx',
  frontmatter: { title: 'Threadplane 0.3.0', description: 'AG-UI 1.0.', date: '2026-10-07', author: 'brian', ...extra },
  content,
});

describe('postImage', () => {
  it('prefers frontmatter image, then the first Markdown image or <img>, whichever comes first', () => {
    expect(postImage(post('![a](/blog/diagrams/a.svg)', { image: '/blog/x/cover.png' }))).toBe('/blog/x/cover.png');
    expect(postImage(post('Intro.\n\n![Flow](/blog/diagrams/flow.svg)\n\n<img src="/blog/x/1.png" />'))).toBe('/blog/diagrams/flow.svg');
    expect(postImage(post('<figure>\n  <img\n    src="/blog/x/hero.png"\n    alt="Hero"\n  />\n</figure>\n\n![b](/b.svg)'))).toBe('/blog/x/hero.png');
    expect(postImage(post('No pictures here.'))).toBeUndefined();
  });
});

describe('buildBlogRss', () => {
  const origin = 'https://threadplane.ai';

  it('keeps the channel and item fields', () => {
    const xml = buildBlogRss([post('Body.')], origin);
    expect(xml).toContain('<link>https://threadplane.ai/blog</link>');
    expect(xml).toContain('<atom:link href="https://threadplane.ai/blog/rss.xml" rel="self" type="application/rss+xml" />');
    expect(xml).toContain('<title><![CDATA[Threadplane 0.3.0]]></title>');
    expect(xml).toContain('<guid isPermaLink="true">https://threadplane.ai/blog/threadplane-0-3-0</guid>');
    expect(xml).toContain('<pubDate>Wed, 07 Oct 2026 00:00:00 GMT</pubDate>');
    expect(xml).toContain('<description><![CDATA[AG-UI 1.0.]]></description>');
  });

  it("lists the post's picture as media:content with an absolute URL", () => {
    const xml = buildBlogRss([post('![Flow](/blog/diagrams/flow.svg)')], origin);
    expect(xml).toContain('xmlns:media="http://search.yahoo.com/mrss/"');
    expect(xml).toContain('<media:content url="https://threadplane.ai/blog/diagrams/flow.svg" medium="image" type="image/svg+xml" />');
  });

  it('lists nothing for a post without a picture', () => {
    expect(buildBlogRss([post('Body.')], origin)).not.toContain('<media:content');
  });
});
