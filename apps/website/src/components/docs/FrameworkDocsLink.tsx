'use client';

import type { ComponentProps } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { preferredDocsHref } from '../../lib/framework-preference';
import { useDocsFramework } from '../../lib/use-docs-framework';

/** Neutral entry links enhance after hydration without importing article or capability inventories. */
export function FrameworkDocsLink(
  props: Omit<ComponentProps<typeof Link>, 'href'>
) {
  const framework = useDocsFramework(usePathname());
  return <Link {...props} href={preferredDocsHref(framework)} />;
}
