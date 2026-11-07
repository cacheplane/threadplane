import Link from 'next/link';
import { Section } from '../ui/Section';
import { Container } from '../ui/Container';
import { PostCard } from '../blog/PostCard';
import { getRecentPosts } from '../../lib/blog';

/**
 * Marketing-home strip showing the most recent posts (including any flagged
 * `featured`). Renders nothing when no posts exist, so the home page stays
 * clean while the blog catalog is small.
 */
export function RecentArticles() {
  const posts = getRecentPosts(3);
  if (posts.length === 0) return null;

  return (
    <Section id="articles" ariaLabelledBy="recent-articles-heading" className="home-section home-articles">
      <Container>
        <div className="home-section-heading">
          <h2 id="recent-articles-heading" className="recent-articles-heading">
            Notes from the flight deck.
          </h2>
          <p>Ideas, patterns, and lessons from building agent interfaces.</p>
        </div>

        <div className="recent-articles-grid">
          {posts.map((p) => (
            <PostCard key={p.slug} post={p} />
          ))}
        </div>

        <div className="recent-articles-footer">
          <Link href="/blog" className="home-text-link">
            View all articles <span aria-hidden="true">›</span>
          </Link>
        </div>
      </Container>
    </Section>
  );
}
