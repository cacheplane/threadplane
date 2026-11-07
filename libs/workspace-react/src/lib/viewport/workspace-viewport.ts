const properties = [
  '--workspace-viewport-height',
  '--workspace-viewport-page-top',
  '--workspace-viewport-offset-top',
] as const;

interface Binding {
  users: number;
  dispose(): void;
}

const bindings = new WeakMap<Document, Binding>();

/** Share parent geometry without rerendering or reaching into runtime frames. */
export function acquireWorkspaceViewport(document: Document): () => void {
  const view = document.defaultView;
  const viewport = view?.visualViewport;
  if (!view || !viewport) return () => undefined;
  let binding = bindings.get(document);
  if (!binding) {
    const style = document.documentElement.style;
    const previous = properties.map((name) => ({
      value: style.getPropertyValue(name),
      priority: style.getPropertyPriority(name),
    }));
    let written: string[] | undefined;
    const update = () => {
      // Browser zoom owns its layout; only keyboard/browser chrome changes fit.
      if (viewport.scale !== 1) return;
      const values = [
        `${viewport.height}px`,
        `${viewport.pageTop ?? view.scrollY + viewport.offsetTop}px`,
        `${viewport.offsetTop}px`,
      ];
      written = values;
      properties.forEach((name, index) =>
        style.setProperty(name, values[index])
      );
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    view.addEventListener('scroll', update);
    binding = {
      users: 0,
      dispose() {
        viewport.removeEventListener('resize', update);
        viewport.removeEventListener('scroll', update);
        view.removeEventListener('scroll', update);
        properties.forEach((name, index) => {
          // Preserve a host's subsequent explicit override, including priority.
          if (
            !written ||
            style.getPropertyValue(name) !== written[index] ||
            style.getPropertyPriority(name) !== ''
          )
            return;
          const saved = previous[index];
          if (saved.value) style.setProperty(name, saved.value, saved.priority);
          else style.removeProperty(name);
        });
      },
    };
    bindings.set(document, binding);
  }
  const owned = binding;
  owned.users++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--owned.users === 0) {
      owned.dispose();
      bindings.delete(document);
    }
  };
}
