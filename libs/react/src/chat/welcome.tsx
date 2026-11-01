'use client';
import type { ReactNode } from 'react';

/** Configures presentation slots without owning conversation visibility or state. */
export interface WelcomeProps {
  /** Custom title content; undefined uses the default h2, null or false omits it. */
  readonly title?: ReactNode;
  /** Input or other content whose mounted identity is retained as other slots change. */
  readonly children?: ReactNode;
  /** Optional suggestion content; null, false and undefined omit the slot. */
  readonly suggestions?: ReactNode;
  /** Additional classes on the welcome container. */
  readonly className?: string;
}

/** Presents a greeting, stable content slot and optional controlled suggestions. */
export function Welcome({
  title,
  children,
  suggestions,
  className,
}: WelcomeProps) {
  return (
    <div className={['tp-welcome', className].filter(Boolean).join(' ')}>
      <div className="tp-welcome__inner">
        <div className="tp-welcome__title">
          {title === undefined ? <h2>How can I help?</h2> : title}
        </div>
        <div className="tp-welcome__content">{children}</div>
        <div className="tp-welcome__suggestions">{suggestions}</div>
      </div>
    </div>
  );
}
