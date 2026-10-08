interface ApiParam {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
}

interface ApiMethod {
  name: string;
  signature: string;
  description: string;
  params?: ApiParam[];
}

export interface ApiDocEntry {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const';
  description: string;
  signature?: string;
  params?: ApiParam[];
  returns?: { type: string; description: string };
  examples?: string[];
  properties?: ApiParam[];
  methods?: ApiMethod[];
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="api-doc-kind-badge">{kind}</span>
  );
}

const PARAM_COLUMNS = [
  ['Parameter', 'key'],
  ['Type', 'prose'],
  ['Description', 'prose'],
] as const;

function ParamTable({ params }: { params: ApiParam[] }) {
  return (
    <div className="docs-table-scroll" tabIndex={0} role="region" aria-label="Parameters table, scrolls horizontally">
    {/* Same annotations rehype-readable-tables gives a markdown table, so the
        phone card layout in docs.css applies here too. */}
    <table className="api-doc-param-table tp-table" data-shape="reference">
      <thead>
        <tr>
          {PARAM_COLUMNS.map(([label, kind]) => (
            <th key={label} className={`tp-col-${kind}`}>{label}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {params.map((p) => (
          <tr key={p.name}>
            <td className="api-doc-param-name tp-col-key" data-label="Parameter">{p.name}{p.optional ? '?' : ''}</td>
            <td className="api-doc-param-type tp-col-prose" data-label="Type">{p.type}</td>
            <td className="api-doc-param-desc tp-col-prose" data-label="Description">{p.description}</td>
          </tr>
        ))}
      </tbody>
    </table>
    </div>
  );
}

export function ApiDocRenderer({ entry }: { entry: ApiDocEntry }) {
  return (
    <div className="api-doc-card">
      <div className="api-doc-header">
        <code className="api-doc-name">{entry.name}</code>
        <KindBadge kind={entry.kind} />
      </div>

      <p className="api-doc-description">{entry.description}</p>

      {entry.signature && (
        <div className="api-doc-signature-wrap">
          <pre className="api-doc-code-pre">
            {entry.signature}
          </pre>
        </div>
      )}

      {entry.params && entry.params.length > 0 && (
        <div className="api-doc-section">
          <h4 className="api-doc-section-title">Parameters</h4>
          <ParamTable params={entry.params} />
        </div>
      )}

      {entry.returns && (
        <div className="api-doc-section">
          <h4 className="api-doc-section-title">Returns</h4>
          <code className="api-doc-inline-code">{entry.returns.type}</code>
        </div>
      )}

      {entry.properties && entry.properties.length > 0 && (
        <div className="api-doc-section">
          <h4 className="api-doc-section-title">Properties</h4>
          <ParamTable params={entry.properties} />
        </div>
      )}

      {entry.methods && entry.methods.length > 0 && (
        <div className="api-doc-section">
          <h4 className="api-doc-section-title">Methods</h4>
          {entry.methods.map((m) => (
            <div key={m.name} className="api-doc-method">
              <code className="api-doc-inline-code">{m.signature}</code>
              {m.description && <p className="api-doc-method-desc">{m.description}</p>}
              {m.params && m.params.length > 0 && <ParamTable params={m.params} />}
            </div>
          ))}
        </div>
      )}

      {entry.examples && entry.examples.length > 0 && (
        <div>
          <h4 className="api-doc-section-title">Examples</h4>
          {entry.examples.map((ex, i) => (
            <div key={i} className="api-doc-example-wrap">
              <pre className="api-doc-code-pre">
                {ex.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')}
              </pre>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
