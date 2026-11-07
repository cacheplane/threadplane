import { createPageMetadata } from '../../lib/site-metadata';
import { getAllPosts, getFeaturedPost, getAllTags } from '../../lib/blog';
import { FeaturedPostCard } from '../../components/blog/FeaturedPostCard';
import { PostCard } from '../../components/blog/PostCard';
import { BlogTagFilter } from '../../components/blog/BlogTagFilter';
import { Button } from '../../components/ui/Button';
import '../../styles/editorial.css';

export const metadata = createPageMetadata({
  title: 'Blog — Threadplane',
  description:
    'Notes on building agent interfaces: production patterns, design choices, and what we are shipping at Threadplane.',
  pathname: '/blog',
  type: 'website',
});

interface Props {
  searchParams: Promise<{ tag?: string }>;
}

export default async function BlogIndexPage({ searchParams }: Props) {
  const { tag: activeTag } = await searchParams;

  const all = getAllPosts();
  const tags = getAllTags().map((t) => t.tag);

  const filtered = activeTag
    ? all.filter((p) => p.frontmatter.tags?.includes(activeTag))
    : all;

  // Featured only when no filter is active — feels like a clean list otherwise.
  const featured = activeTag ? null : getFeaturedPost();
  const grid = featured
    ? filtered.filter((p) => p.slug !== featured.slug)
    : filtered;

  return (
    <div className="blog-index-page editorial-page">
      <div className="blog-index-inner">
        <header className="blog-index-header">
          <h1 className="blog-index-h1">
            Notes from
            <br />
            the flight deck.
          </h1>
          <p className="blog-index-subtitle">
            What we’re building, what we’re learning, and what it takes to put
            agents into real products.
          </p>
        </header>

        {featured ? <FeaturedPostCard post={featured} /> : null}

        <details className="blog-topic-picker" open={Boolean(activeTag)}>
          <summary>
            {activeTag ? `Topic: ${activeTag}` : 'Browse by topic'}
          </summary>
          <BlogTagFilter activeTag={activeTag} tags={tags} />
        </details>

        {grid.length === 0 ? (
          <div className="blog-index-empty">
            <p className="blog-index-empty-text">
              No posts tagged <em>{activeTag}</em> yet.
            </p>
            <Button variant="secondary" href="/blog">
              View all posts
            </Button>
          </div>
        ) : (
          <div className="blog-index-grid">
            {grid.map((p) => (
              <PostCard key={p.slug} post={p} headingLevel={2} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
