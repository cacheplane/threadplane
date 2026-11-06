'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useDocsFramework } from '../../lib/use-docs-framework';
import { preferredDocsHref } from '../../lib/framework-preference';
import {
  trackCtaClick,
  trackExternalLinkClick,
} from '../../lib/analytics/client';
import { LibraryMark } from '../docs/LibraryMark';
import type { NavItem, NavPanel } from './nav-config';

export function trackNavItem(item: NavItem, surface: 'nav' | 'mobile_nav') {
  const ctaId: `nav_${string}` | `mobile_nav_${string}` =
    surface === 'nav' ? `nav_${item.ctaId}` : `mobile_nav_${item.ctaId}`;
  if (item.external) {
    trackExternalLinkClick(item.href, {
      surface,
      cta_id: ctaId,
      cta_text: item.label,
    });
    return;
  }
  trackCtaClick({
    surface,
    destination_url: item.href,
    cta_id: ctaId,
    cta_text: item.label,
  });
}

export function NavPanelItem({
  item,
  surface,
  onNavigate,
}: {
  item: NavItem;
  surface: 'nav' | 'mobile_nav';
  onNavigate?: () => void;
}) {
  const framework = useDocsFramework(usePathname());
  const href = item.frameworkEntry ? preferredDocsHref(framework) : item.href;
  const Icon = item.icon;
  const body = (
    <>
      <span className="nav-panel-item-chip" aria-hidden="true">
        {item.library ? (
          <LibraryMark library={item.library} size={20} />
        ) : Icon ? (
          <Icon size={16} aria-hidden={true} />
        ) : null}
      </span>
      <span className="nav-panel-item-text">
        <span className="nav-panel-item-label">{item.label}</span>
        <span className="nav-panel-item-desc">{item.description}</span>
      </span>
    </>
  );
  const onClick = () => {
    trackNavItem({ ...item, href }, surface);
    onNavigate?.();
  };

  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        className="nav-panel-item"
      >
        {body}
      </a>
    );
  }
  return (
    <Link href={href} onClick={onClick} className="nav-panel-item">
      {body}
    </Link>
  );
}

/**
 * The contents of one nav panel — its columns, then its footer — shared by the
 * desktop hover panel and the mobile drill-in stack.
 *
 * Only the wrapper class names and the mobile drawer's close callback differ
 * between the two surfaces; the column/footer shape itself is the same, and
 * writing it twice let the two drift. The caller still owns the outermost
 * element, because that is where the surfaces genuinely diverge: desktop needs
 * the panel's id and `data-columns`, mobile does not.
 */
export function NavPanelBody({
  panel,
  surface,
  columnsClassName,
  columnClassName,
  onNavigate,
}: {
  panel: NavPanel;
  surface: 'nav' | 'mobile_nav';
  /** Desktop grids its columns inside a wrapper; the mobile stack has none. */
  columnsClassName?: string;
  columnClassName: string;
  onNavigate?: () => void;
}) {
  const columns = panel.columns.map((column, index) => (
    <div key={column.heading ?? index} className={columnClassName}>
      {column.heading ? (
        <span className="nav-panel-col-head">{column.heading}</span>
      ) : null}
      {column.items.map((item) => (
        <NavPanelItem
          key={item.ctaId}
          item={item}
          surface={surface}
          onNavigate={onNavigate}
        />
      ))}
    </div>
  ));

  return (
    <>
      {columnsClassName ? (
        <div className={columnsClassName}>{columns}</div>
      ) : (
        columns
      )}
      {panel.footer ? (
        <div className="nav-panel-footer">
          <span className="nav-panel-footer-lead">{panel.footer.lead}</span>
          <NavPanelItem
            item={panel.footer}
            surface={surface}
            onNavigate={onNavigate}
          />
        </div>
      ) : null}
    </>
  );
}
