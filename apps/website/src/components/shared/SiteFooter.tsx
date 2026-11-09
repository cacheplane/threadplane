'use client';
import { usePathname } from 'next/navigation';
import type { PublicFormPolicy } from '../../lib/growth/form-policy';
import { Footer } from './Footer';

/**
 * Route gate for the marketing footer.
 *
 * The footer is mounted once in the root layout, so every route gets it unless
 * something opts out here. The docs tree opts out: every /docs route renders
 * the sidebar control plane and ends at its own prev/next rail, and a marketing
 * footer bolted under that column breaks the single-pane reading experience.
 * The homepage keeps the footer but drops its newsletter form: the field
 * report form is the homepage's one form (spec §3, block 6), so a second
 * capture form in the footer would just duplicate it.
 */
export function SiteFooter({ formPolicy }: { formPolicy: PublicFormPolicy }) {
  const pathname = usePathname();
  if (pathname === '/docs' || pathname?.startsWith('/docs/')) return null;
  // Production can render / as /index; both must hydrate the same footer.
  const isHomepage = pathname === '/' || pathname === '/index';
  return <Footer formPolicy={formPolicy} showNewsletter={!isHomepage} />;
}
