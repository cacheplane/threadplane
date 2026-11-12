import { Children, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { RenderViewProps } from '../../render/index.js';

/**
 * A2UI Tabs: a tab list with one panel. Selection is local to the mounted
 * surface; only the selected tab's content is rendered. Arrow keys, Home and
 * End move and select, following the reading direction.
 */
export function A2uiTabs({ props, children }: RenderViewProps) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState(0);
  const bodies = Children.toArray(children);
  const raw = props['tabTitles'];
  const titles = bodies.map((_, index) => {
    const value = Array.isArray(raw) ? raw[index] : undefined;
    return typeof value === 'string' ? value : '';
  });
  if (bodies.length === 0) return null;
  // A surface update can remove the selected tab.
  const active = chosen < bodies.length ? chosen : 0;
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    const rtl =
      getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1;
    const last = bodies.length - 1;
    const next =
      event.key === 'ArrowRight'
        ? active + rtl
        : event.key === 'ArrowLeft'
        ? active - rtl
        : event.key === 'Home'
        ? 0
        : event.key === 'End'
        ? last
        : undefined;
    if (next === undefined) return;
    event.preventDefault();
    const index = next < 0 ? last : next > last ? 0 : next;
    setChosen(index);
    list.current
      ?.querySelectorAll<HTMLElement>('[role="tab"]')
      [index]?.focus();
  };
  return (
    <div className="a2ui-tabs">
      <div
        ref={list}
        className="a2ui-tabs__tablist"
        role="tablist"
        onKeyDown={move}
      >
        {titles.map((title, index) => (
          <button
            key={index}
            type="button"
            role="tab"
            id={`${id}tab${index}`}
            className={
              index === active
                ? 'a2ui-tabs__tab a2ui-tabs__tab--active'
                : 'a2ui-tabs__tab'
            }
            aria-selected={index === active}
            aria-controls={`${id}panel`}
            tabIndex={index === active ? 0 : -1}
            onClick={() => setChosen(index)}
          >
            {title}
          </button>
        ))}
      </div>
      <div
        className="a2ui-tabs__panel"
        role="tabpanel"
        id={`${id}panel`}
        aria-labelledby={`${id}tab${active}`}
      >
        {bodies[active]}
      </div>
    </div>
  );
}
