'use client';

import Link from 'next/link';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
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
