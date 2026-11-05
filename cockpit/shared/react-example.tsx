import React, { Children, isValidElement, type ComponentPropsWithoutRef } from 'react';

/** Example chrome only; sessions, controls and rendering stay application-owned. */
export function ExampleLayout({
  children,
  className = '',
  kind = 'chat',
  ...mainProps
}: ComponentPropsWithoutRef<'main'> & {
  readonly kind?: 'chat' | 'render';
}) {
  const nodes = Children.toArray(children);
  const header = nodes.find((node) => isValidElement(node) && node.type === 'header');
  const description = nodes.find(
    (node) => isValidElement<{ role?: string }>(node) && node.type === 'p' && !node.props.role
  );
  return (
    <main {...mainProps} className={`tp-example tp-example--${kind} ${className}`}>
      {header}
      <div className="tp-example__workspace">
        <div className="tp-example__content">
          {nodes.filter((node) => node !== header && node !== description)}
        </div>
        {description && (
          <aside className="tp-example__about" aria-label="About this example">
            <h2>About this example</h2>
            {description}
          </aside>
        )}
      </div>
    </main>
  );
}
