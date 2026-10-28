import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { MdxRenderer } from '../../../components/docs/MdxRenderer';
import { DocsTOC } from '../../../components/docs/DocsTOC';
import { AuthorByline } from '../../../components/blog/AuthorByline';
import { TagChips } from '../../../components/blog/TagChips';
import { Eyebrow } from '../../../components/ui/Eyebrow';
import { getAllPosts, getPostBySlug, formatPostDate, readingTimeMin } from '../../../lib/blog';
import { getAuthor } from '../../../lib/blog-authors';
import { extractHeadings } from '../../../lib/extract-headings';
import { clampMetaDescription, createPageMetadata, ogImagePath } from '../../../lib/site-metadata';
import { getPostLastModified, publishedDate } from '../../../lib/sitemap-dates';
import { JsonLd } from '../../../components/shared/JsonLd';
import { blogPostingJsonLd, breadcrumbJsonLd } from '../../../lib/structured-data';

interface Params {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.frontmatter.draft) {
    return { title: 'Post not found — Threadplane' };
  }
  const author = getAuthor(post.frontmatter.author);
  const pathname = `/blog/${post.slug}`;
  const lastModified = getPostLastModified(post);
  // Undefined for an unparseable frontmatter date, which drops the article
  // block rather than shipping the bad string as `article:published_time`.
  const published = publishedDate(post);

  return createPageMetadata({
    title: `${post.frontmatter.title} — Threadplane`,
    description: clampMetaDescription(post.frontmatter.description),
    pathname,
    type: 'article',
    image: ogImagePath(post.slug, post.frontmatter.ogImage),
    article: published
      ? {
          publishedTime: published.toISOString(),
          modifiedTime: lastModified?.toISOString(),
          authors: [author.name],
          tags: post.frontmatter.tags,
        }
      : undefined,
  });
}


export default async function BlogPostPage({ params }: Params) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post || post.frontmatter.draft) notFound();
  const author = getAuthor(post.frontmatter.author);
  const minutes = readingTimeMin(post.content);
  const primaryTag = post.frontmatter.tags?.[0]
    ? post.frontmatter.tags[0].toUpperCase()
    : 'POST';
  const headings = extractHeadings(post.content);
  // Same derivation `generateMetadata` uses for `article:modified_time`, and the
  // same one the sitemap uses for `<lastmod>`, so all three agree.
  const lastModified = getPostLastModified(post);
  // Undefined for an unparseable frontmatter date; the BlogPosting is dropped
  // rather than published without a `datePublished`, matching the metadata.
  const published = publishedDate(post);

  const postData = published
    ? blogPostingJsonLd({
        title: post.frontmatter.title,
        // Same clamp as the meta description so the two never diverge.
        description: clampMetaDescription(post.frontmatter.description),
        slug: post.slug,
        datePublished: published.toISOString(),
        dateModified: lastModified?.toISOString(),
        authorName: author.name,
        tags: post.frontmatter.tags,
        ogImage: post.frontmatter.ogImage,
      })
    : null;

  const breadcrumbs = breadcrumbJsonLd([
    { name: 'Blog', pathname: '/blog' },
    { name: post.frontmatter.title, pathname: `/blog/${post.slug}` },
  ]);

  return (
    <div className="blog-post-page">
      {postData ? <JsonLd data={postData} /> : null}
      <JsonLd data={breadcrumbs} />
      <div className="blog-post-layout">
      <article className="blog-post-article">
        <header className="blog-post-header">
          <Eyebrow tone="accent" className="blog-post-eyebrow-spaced">
            {primaryTag} · {formatPostDate(post.frontmatter.date)} · {minutes} min read
          </Eyebrow>
          <h1 className="blog-post-h1">
            {post.frontmatter.title}
          </h1>
          <p className="blog-post-subtitle">
            {post.frontmatter.description}
          </p>
          <div className="blog-post-byline-row">
            <AuthorByline author={author} />
          </div>
          {post.frontmatter.tags && post.frontmatter.tags.length > 0 ? (
            <TagChips tags={post.frontmatter.tags} />
          ) : null}
        </header>
        <MdxRenderer source={post.content} docsPath={`/blog/${slug}`} />
      </article>
        <DocsTOC headings={headings} />
      </div>
    </div>
  );
}
