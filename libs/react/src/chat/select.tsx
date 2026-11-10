'use client';
import { useRef, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useAnchoredMenu } from './internal/use-anchored-menu.js';

/** A selectable value and literal label with an optional description and disabled state. Values are unique within one select. */
export interface SelectOption {
  readonly value: string;
  readonly label: string;
  readonly description?: string;
  readonly disabled?: boolean;
}
/** Controls the selected value, list visibility, accessible list name and placeholder for an absent value. */
export interface SelectProps {
  readonly options: readonly SelectOption[];
  readonly value: string;
  readonly onValueChange: (
    value: string,
    event: MouseEvent<HTMLButtonElement>
  ) => void;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly placeholder?: string;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly menuClassName?: string;
}

const selected = (menu: HTMLElement) =>
  menu.querySelector<HTMLElement>('[aria-selected="true"]:not(:disabled)');

/**
 * A controlled single-select dropdown. The owner holds the value and decides
 * whether a requested change or closure is accepted; selecting never performs
 * work by itself.
 */
export function Select({
  options,
  value,
  onValueChange,
  open,
  onOpenChange,
  label,
  placeholder = 'Select',
  disabled,
  className,
  menuClassName,
}: SelectProps) {
  const change = useRef(onValueChange);
  change.current = onValueChange;
  const {
    id,
    trigger,
    menu,
    portal,
    placement,
    effective,
    close,
    ...handlers
  } = useAnchoredMenu({
    open,
    onOpenChange,
    disabled,
    items: options,
    // Chat selects usually sit in a composer at the bottom of the viewport.
    side: 'above',
    gap: 8,
    initialFocus: selected,
  });
  const current = options.find((option) => option.value === value);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={['tp-select__trigger', className].filter(Boolean).join(' ')}
        disabled={disabled === true}
        aria-haspopup="listbox"
        aria-expanded={effective}
        aria-controls={effective ? `${id}-menu` : undefined}
        data-open={effective ? '' : undefined}
        onClick={handlers.triggerProps.onClick}
        onKeyDown={(event) => {
          if (event.key === 'Escape' && effective && !event.defaultPrevented) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          } else handlers.triggerProps.onKeyDown(event);
        }}
      >
        <span className="tp-select__value">
          {current?.label ?? placeholder}
        </span>
        <svg
          className="tp-select__chevron"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {effective &&
        portal &&
        createPortal(
          <div
            ref={menu}
            id={`${id}-menu`}
            role="listbox"
            aria-label={label}
            tabIndex={-1}
            dir={portal.style.direction === 'rtl' ? 'rtl' : 'ltr'}
            className={['tp-select__menu', menuClassName]
              .filter(Boolean)
              .join(' ')}
            style={{ ...portal.style, ...placement }}
            {...handlers.menuProps}
          >
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                tabIndex={-1}
                data-item-id={option.value}
                disabled={option.disabled === true}
                className="tp-select__option"
                onClick={(event) => {
                  event.stopPropagation();
                  if (event.defaultPrevented || option.disabled === true)
                    return;
                  close(true);
                  if (option.value !== value)
                    change.current(option.value, event);
                }}
              >
                <span className="tp-select__option-label">{option.label}</span>
                {option.description ? (
                  <span className="tp-select__option-description">
                    {option.description}
                  </span>
                ) : null}
              </button>
            ))}
          </div>,
          portal.document.body
        )}
    </>
  );
}
