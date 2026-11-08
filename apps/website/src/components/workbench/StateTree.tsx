import type { Json } from './playback';

export function StateTree({
  value,
  expanded,
  onToggle,
}: {
  readonly value: Json;
  readonly expanded: ReadonlySet<string>;
  readonly onToggle: (path: string) => void;
}) {
  function node(value: Json, name: string, path: string, root = false) {
    if (value === null || typeof value !== 'object') {
      return (
        <li key={path}>
          <span className="tp-learn-key">{name}</span>
          <span className="tp-learn-value">{JSON.stringify(value)}</span>
        </li>
      );
    }
    const entries = Object.entries(value);
    const open = root || expanded.has(path);
    return (
      <li key={path}>
        {root ? (
          <span className="tp-learn-key">{name}</span>
        ) : (
          <button
            type="button"
            aria-expanded={open}
            aria-label={`${open ? 'Collapse' : 'Expand'} ${name}`}
            onClick={() => onToggle(path)}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span> {name}{' '}
            <span className="tp-learn-dim">
              {Array.isArray(value)
                ? `[${entries.length}]`
                : `{${entries.length}}`}
            </span>
          </button>
        )}
        {open && (
          <ul>
            {entries.map(([key, child]) =>
              node(
                child,
                key,
                `${path}/${key.replace(/~/g, '~0').replace(/\//g, '~1')}`
              )
            )}
          </ul>
        )}
      </li>
    );
  }
  return (
    <ul className="tp-learn-tree" aria-label="Application state tree">
      {node(value, 'application', '', true)}
    </ul>
  );
}
