'use client';

import { useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import {
  Bot,
  Check,
  Copy,
  Ellipsis,
  FileText,
  ListTree,
  SquarePen,
} from 'lucide-react';
import { analyticsEvents } from '../../lib/analytics/events';
import { track } from '../../lib/analytics/client';
import type { DocHeading } from '../../lib/extract-headings';
import { SITE_ORIGIN } from '../../lib/site-origin';

const GITHUB_EDIT_BASE =
  'https://github.com/cacheplane/threadplane/edit/main/apps/website/content/docs';

interface Props {
  library: string;
  section: string;
  slug: string;
  headings: DocHeading[];
}

export function PageActions({ library, section, slug, headings }: Props) {
  const tooltipId = useId();
  const [open, setOpen] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showHeadings, setShowHeadings] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreTriggerFocus = useRef(true);

  const closeMenu = () => {
    setOpen(false);
    setShowHeadings(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) closeMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      if (restoreTriggerFocus.current) triggerRef.current?.focus();
    };
  }, [open]);

  useEffect(() => {
    if (open) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTooltipDismissed(true);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const onMenuKeyDown = (event: ReactKeyboardEvent) => {
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [],
    );
    if (items.length === 0) return;
    const current = Math.max(0, items.indexOf(document.activeElement as HTMLElement));
    const move = (index: number) => {
      event.preventDefault();
      items[(index + items.length) % items.length]?.focus();
    };
    if (event.key === 'ArrowDown') move(current + 1);
    if (event.key === 'ArrowUp') move(current - 1);
    if (event.key === 'Home') move(0);
    if (event.key === 'End') move(items.length - 1);
  };

  const path = `${library}/${section}/${slug}`;
  const pageUrl = `${SITE_ORIGIN}/docs/${path}`;
  const markdownUrl = `/api/markdown/${path}`;
  const chatgptUrl = `https://chatgpt.com/?hints=search&q=${encodeURIComponent(
    `Read this Threadplane docs page and help me apply it to my project: ${pageUrl}`,
  )}`;
  const githubUrl = `${GITHUB_EDIT_BASE}/${path}.mdx`;

  const copyMarkdown = async () => {
    try {
      const response = await fetch(markdownUrl);
      if (!response.ok) throw new Error(String(response.status));
      await navigator.clipboard.writeText(await response.text());
      track(analyticsEvents.docsCopyCodeClick, {
        surface: 'docs',
        cta_id: 'copy_page_markdown',
      });
      setCopied(true);
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const openOnThisPage = () => {
    const toc = document.getElementById('docs-on-this-page');
    if (toc && toc.getClientRects().length > 0) {
      restoreTriggerFocus.current = false;
      closeMenu();
      toc.focus();
      return;
    }
    setShowHeadings(true);
  };

  return (
    <div ref={ref} className="docs-page-actions">
      <button
        type="button"
        ref={triggerRef}
        aria-label="Page actions"
        aria-describedby={!open && !tooltipDismissed ? tooltipId : undefined}
        aria-haspopup="menu"
        aria-expanded={open}
        onFocus={() => setTooltipDismissed(false)}
        onPointerEnter={() => setTooltipDismissed(false)}
        onClick={() => {
          restoreTriggerFocus.current = true;
          setOpen((current) => !current);
          if (open) setShowHeadings(false);
        }}
        className="docs-page-actions-trigger"
      >
        <Ellipsis size={18} strokeWidth={2} aria-hidden="true" />
      </button>
      {!open && !tooltipDismissed ? (
        <span id={tooltipId} role="tooltip" className="docs-page-actions-tooltip">
          Page actions
        </span>
      ) : null}
      {open ? (
        <div
          role="menu"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
          className="docs-page-actions-menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={openOnThisPage}
            className="docs-page-actions-item"
          >
            <ListTree size={16} aria-hidden="true" />
            <span>On this page</span>
          </button>
          {showHeadings ? (
            <div className="docs-page-actions-headings">
              {headings.map((heading) => (
                <a
                  key={heading.id}
                  role="menuitem"
                  href={`#${heading.id}`}
                  data-level={heading.level}
                  onClick={closeMenu}
                  className="docs-page-actions-heading"
                >
                  {heading.text}
                </a>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyMarkdown()}
            className="docs-page-actions-item"
          >
            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
            <span>{copied ? 'Copied' : 'Copy page as Markdown'}</span>
          </button>
          <div className="docs-page-actions-separator" role="separator" />
          <a
            role="menuitem"
            href={chatgptUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="docs-page-actions-item"
          >
            <Bot size={16} aria-hidden="true" />
            <span>Open in ChatGPT</span>
          </a>
          <a
            role="menuitem"
            href={markdownUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="docs-page-actions-item"
          >
            <FileText size={16} aria-hidden="true" />
            <span>View as Markdown</span>
          </a>
          <a
            role="menuitem"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={closeMenu}
            className="docs-page-actions-item"
          >
            <SquarePen size={16} aria-hidden="true" />
            <span>Edit on GitHub</span>
          </a>
        </div>
      ) : null}
    </div>
  );
}
