import React, { Children, isValidElement, useEffect, useRef, type ReactNode, type ComponentPropsWithoutRef } from 'react';

/** Explicit application-owned composer/status region, including nested workspaces. */
export function ExampleFooter({ children }: { readonly children: ReactNode }) {
  return <footer className="tp-example__footer">{children}</footer>;
}

/** Example chrome only; sessions, controls and rendering stay application-owned. */
export function ExampleLayout({
  children,
  className = '',
  kind = 'chat',
  footer,
  about,
  ...mainProps
}: Omit<ComponentPropsWithoutRef<'main'>, 'about'> & {
  readonly kind?: 'chat' | 'render';
  readonly footer?: ReactNode;
  readonly about?: ReactNode;
}) {
  const shell = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = shell.current;
    const viewport = element?.ownerDocument.defaultView?.visualViewport;
    if (!element || !viewport) return;
    const resize = () => {
      // iOS keyboards shrink the visual viewport, not dvh. Leave pinch zoom alone.
      if (viewport.scale !== 1) return;
      element.style.setProperty('--example-viewport-height', `${viewport.height}px`);
      element.style.setProperty('--example-viewport-top', `${viewport.offsetTop}px`);
    };
    resize();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', resize);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', resize);
    };
  }, []);
  const nodes = Children.toArray(children);
  const header = nodes.find((node) => isValidElement(node) && node.type === 'header');
  const description = nodes.find(
    (node) => isValidElement<{ role?: string }>(node) && node.type === 'p' && !node.props.role
  );
  const composer = nodes.find((node) => isValidElement(node) && node.type === ExampleFooter);
  return (
    <main {...mainProps} ref={shell} className={`tp-example tp-example--${kind} ${className}`}>
      <div className="tp-example__workspace">
        <div className="tp-example__conversation">
          {header}
          <div className="tp-example__content">
            {nodes.filter((node) => node !== header && node !== description && node !== composer)}
          </div>
          {footer ? <ExampleFooter>{footer}</ExampleFooter> : composer}
        </div>
        {(description || about) && (
          <aside className="tp-example__about" aria-label="About this example">
            <h2>About this example</h2>
            {description}
            {about}
            <p className="tp-example__framework">React · Experimental</p>
          </aside>
        )}
      </div>
    </main>
  );
}
