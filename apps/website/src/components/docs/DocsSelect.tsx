'use client';

import { Fragment, useId } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { useDocsDropdown } from './use-docs-dropdown';

function selectionLabel(label: string) {
  const parts = label.split('/');
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? <wbr /> : null}
      {part}
      {index < parts.length - 1 ? '/' : null}
    </Fragment>
  ));
}

/** Labelled single selection with the same keyboard behavior as docs navigation. */
export function DocsSelect<Value extends string>({
  label,
  value,
  options,
  onChange,
  apiScope,
}: {
  label: string;
  value: Value;
  options: readonly { value: Value; label: string }[];
  onChange: (value: Value) => void;
  apiScope?: string;
}) {
  const id = useId();
  const menu = useDocsDropdown();
  return (
    <div
      ref={menu.ref}
      className="docs-select"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          menu.setOpen(false);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <button
        id={id}
        ref={menu.triggerRef}
        type="button"
        className="docs-select-trigger"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        aria-controls={menu.menuId}
        data-api-scope={apiScope}
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
        <span>
          {selectionLabel(
            options.find((item) => item.value === value)?.label ?? ''
          )}
        </span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {menu.open ? (
        <div
          id={menu.menuId}
          ref={menu.menuRef}
          role="menu"
          aria-label={label}
          className="docs-select-menu"
          onKeyDown={menu.onMenuKeyDown}
        >
          {options.map((item) => (
            <button
              key={item.value}
              type="button"
              role="menuitemradio"
              tabIndex={-1}
              aria-checked={value === item.value}
              className="docs-select-item"
              onClick={() => {
                menu.closeMenu(true);
                onChange(item.value);
              }}
            >
              <span data-docs-menu-title>{selectionLabel(item.label)}</span>
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
  );
}
