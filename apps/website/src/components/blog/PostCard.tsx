import Link from 'next/link';
import type { Post } from '../../lib/blog';
import { formatCardDate, readingTimeMin } from '../../lib/blog';

export function PostCard({
  post,
  headingLevel = 3,
}: {
  post: Post;
  headingLevel?: 2 | 3;
}) {
  const { slug, frontmatter, content } = post;
  const minutes = readingTimeMin(content);
  const Heading = headingLevel === 2 ? 'h2' : 'h3';

  return (
    <Link
      href={`/blog/${slug}`}
      data-ui="card"
      data-hoverable
      className="post-card"
    >
      <span className="post-card-meta">
        {formatCardDate(frontmatter.date)} · {minutes} min read
      </span>
      <Heading className="post-card-title">{frontmatter.title}</Heading>
      <p className="post-card-description">{frontmatter.description}</p>
      {frontmatter.tags && frontmatter.tags.length > 0 ? (
        <div className="post-card-tags">
          {frontmatter.tags.map((tag) => (
            <span key={tag} className="post-card-tag">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </Link>
  );
}
