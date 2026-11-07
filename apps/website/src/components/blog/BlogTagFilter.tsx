import Link from 'next/link';

interface BlogTagFilterProps {
  /** Currently active tag from ?tag=. Undefined when on /blog. */
  activeTag?: string;
  /** All known tags (already sorted by caller, or sort here). */
  tags: string[];
}

export function BlogTagFilter({ activeTag, tags }: BlogTagFilterProps) {
  const sorted = [...tags].sort((a, b) => a.localeCompare(b));
  return (
    <nav className="blog-tag-filter" aria-label="Filter articles by topic">
      {/* "All" pill */}
      {activeTag ? (
        <Link href="/blog" className="blog-tag-pill">
          All
        </Link>
      ) : (
        <span
          className="blog-tag-pill"
          data-active
          data-static
          aria-current="page"
        >
          All
        </span>
      )}

      {sorted.map((tag) => {
        const isActive = tag === activeTag;
        // Clicking the active tag toggles back to /blog.
        const href = isActive
          ? '/blog'
          : `/blog?tag=${encodeURIComponent(tag)}`;
        return isActive ? (
          <Link
            key={tag}
            href={href}
            className="blog-tag-pill"
            data-active
            aria-current="page"
          >
            {tag}
          </Link>
        ) : (
          <Link key={tag} href={href} className="blog-tag-pill">
            {tag}
          </Link>
        );
      })}
    </nav>
  );
}
