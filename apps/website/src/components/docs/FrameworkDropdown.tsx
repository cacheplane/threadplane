'use client';

import { Check, ChevronDown } from 'lucide-react';
import type { DocsFramework } from '@threadplane/cockpit-registry/docs-routes';
import { AngularMark, ReactMark } from '../ui/FrameworkMarks';
import { useDocsDropdown } from './use-docs-dropdown';

export function FrameworkDropdown({
  id,
  value,
  disabled,
  unavailable,
  onChange,
}: {
  id: string;
  value: DocsFramework;
  disabled: boolean;
  unavailable: readonly DocsFramework[];
  onChange: (framework: DocsFramework) => void;
}) {
  const menu = useDocsDropdown();
  return (
    <div
      ref={menu.ref}
      className="docs-sidebar-library docs-framework-dropdown"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          menu.setOpen(false);
      }}
    >
      <button
        id={id}
        ref={menu.triggerRef}
        type="button"
        disabled={disabled}
        data-framework-control
        data-value={value}
        className="docs-sidebar-lib-trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open && !disabled}
        aria-controls={menu.menuId}
        aria-describedby={`${id}-value`}
        onClick={() =>
          menu.open ? menu.closeMenu(true) : menu.openMenu('selected')
        }
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            menu.openMenu(event.key === 'ArrowDown' ? 'first' : 'last');
          }
        }}
      >
        <span className="docs-sidebar-lib-trigger-inner">
          <span className="docs-framework-option-mark">
            {value === 'angular' ? <AngularMark /> : <ReactMark />}
          </span>
          <span id={`${id}-value`} className="docs-sidebar-lib-trigger-label">
            {value === 'angular' ? 'Angular' : 'React'}
          </span>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          data-open={menu.open || undefined}
        />
      </button>
      {menu.open && !disabled ? (
        <div
          id={menu.menuId}
          ref={menu.menuRef}
          role="menu"
          aria-label="Frameworks"
          className="docs-sidebar-lib-menu"
          onKeyDown={menu.onMenuKeyDown}
        >
          {(['angular', 'react'] as const).map((framework) => {
            const active = value === framework;
            const unavailableTopic = unavailable.includes(framework);
            return (
              <button
                key={framework}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={active}
                aria-disabled={unavailableTopic || undefined}
                className="docs-sidebar-lib-item"
                data-active={active || undefined}
                onClick={() => {
                  if (disabled || unavailableTopic) return;
                  menu.closeMenu(true);
                  onChange(framework);
                }}
              >
                <span className="docs-framework-option-mark">
                  {framework === 'angular' ? <AngularMark /> : <ReactMark />}
                </span>
                <span className="docs-sidebar-lib-item-text">
                  <span
                    className="docs-sidebar-lib-item-title"
                    data-docs-menu-title
                  >
                    {framework === 'angular' ? 'Angular' : 'React'}
                  </span>
                  {unavailableTopic ? (
                    <span className="docs-sidebar-lib-item-desc">
                      Unavailable for this topic
                    </span>
                  ) : null}
                </span>
                <Check
                  className="docs-sidebar-lib-item-check"
                  size={16}
                  aria-hidden="true"
                  visibility={active ? 'visible' : 'hidden'}
                />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
