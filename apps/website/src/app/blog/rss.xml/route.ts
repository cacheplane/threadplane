import { NextResponse } from 'next/server';
import { getAllPosts } from '../../../lib/blog';
import { buildBlogRss } from '../../../lib/blog-rss';
import { SITE_ORIGIN } from '../../../lib/site-metadata';

export async function GET() {
  return new NextResponse(buildBlogRss(getAllPosts(), SITE_ORIGIN), {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
