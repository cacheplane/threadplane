import Link from 'next/link';
import type { Post } from '../../lib/blog';
import { formatCardDate, readingTimeMin } from '../../lib/blog';
import { getAuthor } from '../../lib/blog-authors';
import { AuthorByline } from './AuthorByline';

export function FeaturedPostCard({ post }: { post: Post }) {
  const { slug, frontmatter, content } = post;
  const author = getAuthor(frontmatter.author);
  const minutes = readingTimeMin(content);

  return (
    <Link
      href={`/blog/${slug}`}
      data-ui="card"
      data-hoverable
      className="featured-post-card"
    >
      <div className="featured-post-copy">
        <h2 className="featured-post-card-title">{frontmatter.title}</h2>
        <p className="featured-post-card-description">
          {frontmatter.description}
        </p>
        <div className="featured-post-card-footer">
          <AuthorByline author={author} />
          <span className="featured-post-card-meta">
            {formatCardDate(frontmatter.date)} · {minutes} min read
          </span>
        </div>
        <span className="featured-post-read">
          Read the article <span aria-hidden="true">↗</span>
        </span>
      </div>
      <div className="featured-post-art" aria-hidden="true">
        <div className="featured-post-paper">
          <i />
          <div>
            <span />
            <span />
          </div>
          <div>
            <span />
            <span />
            <span />
          </div>
          <b />
          <div>
            <span />
            <span />
          </div>
        </div>
      </div>
    </Link>
  );
}
