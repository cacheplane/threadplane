'use client';
import Link from 'next/link';

export function CardGroup({ cols = 2, children }: { cols?: number; children: React.ReactNode }) {
  return (
    <div
      className="mdx-card-group"
      style={{ '--card-min': `${100 / cols - 2}%` } as React.CSSProperties}
    >
      {children}
    </div>
  );
}

export function Card({
  title,
  href,
  external = false,
  children,
}: {
  title: string;
  href: string;
  /** When true, open in a new tab (for off-site links: demos, GitHub, etc.). */
  external?: boolean;
  children: React.ReactNode;
}) {
  const externalProps = external
    ? { target: '_blank', rel: 'noopener noreferrer' }
    : {};
  return (
    <div data-mdx="card">
      <Link href={href} className="mdx-card-link mdx-card-row" data-mdx-chrome="" {...externalProps}>
        <div>
          <div className="mdx-card-title">{title}</div>
        </div>
        <span className="mdx-card-arrow" aria-hidden="true">→</span>
      </Link>
      <div className="mdx-card-body">{children}</div>
    </div>
  );
}
