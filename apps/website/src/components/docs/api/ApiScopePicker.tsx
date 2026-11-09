'use client';

import { useId } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDocsDropdown } from '../use-docs-dropdown';
import { API_SCOPES, type ApiScope } from './use-api-scope';

export function ApiScopePicker({
  value,
  onChange,
}: {
  value: ApiScope;
  onChange: (value: ApiScope) => void;
}) {
  const id = useId();
  const menu = useDocsDropdown();
  return (
    <div className="api-scope-picker">
      <label htmlFor={id}>API scope</label>
      <div
        ref={menu.ref}
        className="docs-sidebar-library"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            menu.setOpen(false);
        }}
      >
        <button
          id={id}
          ref={menu.triggerRef}
          type="button"
          className="docs-sidebar-lib-trigger"
          aria-haspopup="menu"
          aria-expanded={menu.open}
          aria-controls={menu.menuId}
          data-api-scope={value}
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
          <span>{API_SCOPES.find((item) => item.value === value)?.label}</span>
          <ChevronDown size={16} aria-hidden="true" />
        </button>
        {menu.open ? (
          <div
            id={menu.menuId}
            ref={menu.menuRef}
            role="menu"
            aria-label="API scopes"
            className="docs-sidebar-lib-menu"
            onKeyDown={menu.onMenuKeyDown}
          >
            {API_SCOPES.map((item) => (
              <button
                key={item.value}
                type="button"
                role="menuitemradio"
                tabIndex={-1}
                aria-checked={value === item.value}
                className="docs-sidebar-lib-item"
                data-active={value === item.value || undefined}
                onClick={() => {
                  menu.closeMenu(true);
                  onChange(item.value);
                }}
              >
                <span
                  className="docs-sidebar-lib-item-text"
                  data-docs-menu-title
                >
                  {item.label}
                </span>
                <Check
                  size={16}
                  aria-hidden="true"
                  visibility={value === item.value ? 'visible' : 'hidden'}
                />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
