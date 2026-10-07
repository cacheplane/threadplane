'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { ChevronDown } from 'lucide-react';
import {
  trackCtaClick,
  trackExternalLinkClick,
} from '../../lib/analytics/client';
import { Button } from '../ui/Button';
import { GitHubIcon } from '../ui/GitHubIcon';
import { GITHUB_REPO_URL } from '../../lib/positioning';
import { NavPanelBody } from './NavPanelBody';
import { clampPanelLeft } from './nav-panel-position';
import { NAV_TRIGGERS, type NavPanel } from './nav-config';

/** Long enough to cross the gap between trigger and panel diagonally. */
const OPEN_DELAY_MS = 100;
const CLOSE_DELAY_MS = 150;

function Panel({ panel, id }: { panel: NavPanel; id: string }) {
  return (
    <div id={id} className="nav-panel" data-columns={panel.columns.length}>
      <NavPanelBody
        panel={panel}
        surface="nav"
        columnsClassName="nav-panel-cols"
        columnClassName="nav-panel-col"
      />
    </div>
  );
}

export function NavDesktop() {
  const [openId, setOpenId] = useState<string | null>(null);
  const panelPrefix = useId();
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  useEffect(() => {
    if (!openId) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      clearTimers();
      triggerRefs.current.get(openId)?.focus();
      setOpenId(null);
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [clearTimers, openId]);

  // Seat the open panel under its trigger. `.nav-panel-shell` is absolutely
  // positioned against `.nav-bar > div` and reads `--nav-panel-left` for its
  // left edge; a trigger's offsetLeft is measured from that same box because
  // nothing between them is positioned (see .nav-desktop in chrome.css). A
  // layout effect runs before paint, so the panel never flashes at left:0.
  //
  // The panel is max-content wide, so its width moves whenever its text
  // does — the mono web font landing a beat after a cold load is enough to
  // widen it by a pixel or two and push a clamped panel past the row. The
  // ResizeObserver re-seats it on any such change; the resize listener is
  // for the row changing width under a panel whose own size did not.
  useLayoutEffect(() => {
    if (!openId) return undefined;
    const shell = shellRef.current;
    const trigger = triggerRefs.current.get(openId);
    const row = shell?.offsetParent;
    const panel = shell?.firstElementChild;
    if (
      !shell ||
      !trigger ||
      !(row instanceof HTMLElement) ||
      !(panel instanceof HTMLElement)
    ) {
      return undefined;
    }
    const position = () => {
      const rowStyle = getComputedStyle(row);
      const left = clampPanelLeft({
        triggerLeft: trigger.offsetLeft,
        panelWidth: panel.offsetWidth,
        rowWidth: row.clientWidth,
        rowPaddingLeft: Number.parseFloat(rowStyle.paddingLeft) || 0,
        rowPaddingRight: Number.parseFloat(rowStyle.paddingRight) || 0,
      });
      shell.style.setProperty('--nav-panel-left', `${left}px`);
    };
    position();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(position);
    observer?.observe(panel);
    window.addEventListener('resize', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
    };
  }, [openId]);

  const scheduleOpen = (id: string) => {
    clearTimers();
    openTimer.current = window.setTimeout(() => setOpenId(id), OPEN_DELAY_MS);
  };
  const scheduleClose = () => {
    clearTimers();
    closeTimer.current = window.setTimeout(
      () => setOpenId(null),
      CLOSE_DELAY_MS
    );
  };

  const panelId = (id: string) => `${panelPrefix}-${id}`;

  return (
    <div
      className="hidden lg:flex items-center nav-desktop"
      onMouseLeave={scheduleClose}
    >
      {/* Triggers follow the logo; actions sit at the row's far edge. Both
       * groups stay unpositioned so a trigger's offsetLeft keeps measuring
       * from `.nav-bar > div`, which is what the panel positioning reads. */}
      <div className="flex items-center gap-8 nav-desktop-primary">
        {NAV_TRIGGERS.map((trigger) =>
          trigger.kind === 'link' ? (
            <Link
              key={trigger.id}
              href={trigger.href}
              onMouseEnter={() => {
                clearTimers();
                setOpenId(null);
              }}
              onClick={() =>
                trackCtaClick({
                  surface: 'nav',
                  destination_url: trigger.href,
                  cta_id: `nav_${trigger.ctaId}`,
                  cta_text: trigger.label,
                })
              }
              className="text-sm font-mono transition-colors nav-link"
            >
              {trigger.label}
            </Link>
          ) : (
            <Fragment key={trigger.id}>
              <button
                type="button"
                ref={(node) => {
                  if (node) triggerRefs.current.set(trigger.id, node);
                  else triggerRefs.current.delete(trigger.id);
                }}
                onMouseEnter={() => scheduleOpen(trigger.id)}
                onClick={() => {
                  clearTimers();
                  setOpenId((current) =>
                    current === trigger.id ? null : trigger.id
                  );
                }}
                aria-expanded={openId === trigger.id}
                aria-controls={
                  openId === trigger.id ? panelId(trigger.id) : undefined
                }
                className="text-sm font-mono transition-colors nav-link nav-trigger"
              >
                {trigger.label}
                <ChevronDown
                  size={14}
                  strokeWidth={2}
                  aria-hidden="true"
                  data-open={openId === trigger.id || undefined}
                  className="nav-trigger-caret"
                />
              </button>
              {openId === trigger.id ? (
                <div
                  ref={shellRef}
                  className="nav-panel-shell"
                  onMouseEnter={clearTimers}
                  onMouseLeave={scheduleClose}
                >
                  <Panel panel={trigger.panel} id={panelId(trigger.id)} />
                </div>
              ) : null}
            </Fragment>
          )
        )}
      </div>

      <div className="flex items-center gap-8 nav-desktop-actions">
        <a
          href={GITHUB_REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() =>
            trackExternalLinkClick(GITHUB_REPO_URL, {
              surface: 'nav',
              cta_id: 'nav_github',
              cta_text: 'GitHub',
            })
          }
          className="transition-colors nav-link"
          aria-label="GitHub repository"
        >
          <GitHubIcon />
        </a>
        <Button
          variant="primary"
          size="md"
          href="/contact"
          onClick={() =>
            trackCtaClick({
              surface: 'nav',
              destination_url: '/contact',
              cta_id: 'nav_talk_to_us',
              cta_text: 'Talk to Us',
            })
          }
        >
          Talk to Us
        </Button>
      </div>
    </div>
  );
}
