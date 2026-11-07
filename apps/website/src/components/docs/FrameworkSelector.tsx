'use client';

import { useId, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  parseDocsNarrativePath,
  type DocsFramework,
} from '@threadplane/cockpit-registry/docs-routes';
import type { DocsScope } from '../../lib/docs-catalog';
import {
  frameworkPreference,
  preferredDocsHref,
} from '../../lib/framework-preference';
import { useDocsFramework } from '../../lib/use-docs-framework';
import { FrameworkDropdown } from './FrameworkDropdown';
import { isFrameworkDocsRoute } from '../../lib/docs-presentation';

export interface FrameworkTarget {
  href: string;
  modes: readonly ('Docs' | 'Run' | 'Code' | 'API')[];
  anchors: readonly string[];
}

export interface FrameworkSelectorProps {
  scope?: DocsScope;
  documentId?: string;
  /** Counterpart availability and capabilities are resolved on the server. */
  targets?: Partial<Record<DocsFramework, FrameworkTarget>>;
  onNavigate?: () => void;
  /** The workspace owns pending navigation across adaptive drawer mounts. */
  navigationPending?: boolean;
  navigateTo?: (href: string) => void;
}

function counterpartHref(target: FrameworkTarget): string {
  const mode = new URLSearchParams(window.location.search)
    .get('mode')
    ?.toLowerCase();
  const supportedMode = target.modes.find(
    (candidate) => candidate.toLowerCase() === mode
  );
  const query =
    supportedMode && supportedMode !== 'Docs'
      ? `?mode=${supportedMode.toLowerCase()}`
      : '';
  let anchor = '';
  try {
    const decoded = decodeURIComponent(window.location.hash.slice(1));
    if (target.anchors.includes(decoded))
      anchor = `#${encodeURIComponent(decoded)}`;
  } catch {
    /* Invalid fragments start at the target article title. */
  }
  return `${target.href}${query}${anchor}`;
}

export function FrameworkSelector({
  scope,
  documentId,
  targets,
  onNavigate,
  navigationPending = false,
  navigateTo,
}: FrameworkSelectorProps) {
  const pathname = usePathname() ?? '';
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const framework = useDocsFramework(pathname);
  const identity = parseDocsNarrativePath(pathname);
  const hasFrameworkTopic =
    identity?.scope === 'framework' ||
    (Boolean(documentId) && scope !== 'shared');
  const id = useId();
  const isSwitching =
    navigationPending ||
    isPending ||
    (identity?.scope === 'framework' &&
      (scope === 'angular' || scope === 'react') &&
      scope !== identity.framework);
  const unavailable = (['angular', 'react'] as const).filter(
    (candidate) =>
      hasFrameworkTopic && candidate !== framework && !targets?.[candidate]
  );
  const choose = (selected: DocsFramework) => {
    if (isSwitching || (selected !== 'angular' && selected !== 'react')) return;
    const target = targets?.[selected];
    if (hasFrameworkTopic && selected !== framework && !target) return;
    frameworkPreference.setPreference(selected);
    if (hasFrameworkTopic && selected !== framework && target) {
      onNavigate?.();
      const href = counterpartHref(target);
      if (navigateTo) navigateTo(href);
      else startTransition(() => router.push(href));
    }
  };

  return (
    <div className="px-3 py-3" data-framework-selector>
      <label
        htmlFor={id}
        className="block mb-2 text-xs font-semibold text-[var(--color-text-muted)]"
      >
        Framework
      </label>
      {isFrameworkDocsRoute(pathname) ? (
        <FrameworkDropdown
          id={id}
          value={framework}
          disabled={isSwitching}
          unavailable={unavailable}
          onChange={choose}
        />
      ) : (
        <select
          id={id}
          data-framework-control
          data-value={framework}
          value={framework}
          disabled={isSwitching}
          onChange={(event) => choose(event.target.value as DocsFramework)}
          className="h-11 md:h-9 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-sm text-[var(--color-text-primary)]"
        >
          {(['angular', 'react'] as const).map((candidate) => (
            <option
              key={candidate}
              value={candidate}
              disabled={unavailable.includes(candidate)}
            >
              {candidate === 'angular' ? 'Angular' : 'React'}
              {unavailable.includes(candidate) ? ' (unavailable)' : ''}
            </option>
          ))}
        </select>
      )}
      {unavailable.map((candidate) => (
        <div
          key={candidate}
          className="mt-2 text-xs text-[var(--color-text-muted)]"
        >
          <p>
            This topic is not available for{' '}
            {candidate === 'react' ? 'React' : 'Angular'}.
          </p>
          <Link
            href={preferredDocsHref(candidate)}
            onClick={() => {
              frameworkPreference.setPreference(candidate);
              onNavigate?.();
            }}
            data-workspace-navigation-link
            className="underline"
          >
            {candidate === 'react' ? 'React' : 'Angular'} introduction
          </Link>
        </div>
      ))}
    </div>
  );
}
