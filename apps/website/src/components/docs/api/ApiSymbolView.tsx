import Link from 'next/link';
import {
  apiMemberAnchor,
  apiDeclarationTokens,
  apiSummary,
  type ApiEntrypoint,
  type ApiMember,
  type ApiSymbol,
  type ApiTokenRange,
} from '../../../lib/api-reference-model';
import { apiImport, apiSourceUrl } from '../../../lib/api-reference';
import { ApiCode } from './ApiCode';
import { ApiMarkdown } from './ApiMarkdown';

function TypeExcerpt({
  member,
  range,
}: {
  member: ApiMember;
  range?: ApiTokenRange;
}) {
  if (!range) return null;
  const tokens = member.excerptTokens.slice(range.startIndex, range.endIndex);
  return (
    <code>
      {tokens.map((token, index) =>
        token.href ? (
          <Link key={index} href={token.href}>
            {token.text}
          </Link>
        ) : (
          token.text
        )
      )}
    </code>
  );
}

async function Declaration({
  member,
  index,
  nested = false,
  pageSummary,
}: {
  member: ApiMember;
  index: number;
  nested?: boolean;
  pageSummary?: string;
}) {
  const docs = member.docs;
  const Heading = nested ? 'h3' : 'h2';
  return (
    <section
      key={`${member.canonicalReference}-${index}`}
      className="api-reference-declaration"
      id={apiMemberAnchor(member, index)}
    >
      <Heading>
        {nested ? member.name : 'Declaration'}
        {member.overloadIndex ? ` · overload ${member.overloadIndex}` : ''}
      </Heading>
      {docs.summary && (nested || docs.summary !== pageSummary) ? (
        <ApiMarkdown source={docs.summary} />
      ) : null}
      {docs.deprecated ? (
        <div className="api-reference-notice">
          <strong>Deprecated</strong>
          <ApiMarkdown source={docs.deprecated} />
        </div>
      ) : null}
      <ApiCode tokens={apiDeclarationTokens(member)} />
      {member.angular ? (
        <section className="api-reference-bindings">
          <h3>Angular template API</h3>
          <p>
            Selector: <code>{member.angular.selector}</code>
          </p>
          {(['inputs', 'outputs'] as const).map((kind) =>
            member.angular?.[kind].length ? (
              <div key={kind}>
                <h4>{kind === 'inputs' ? 'Inputs' : 'Outputs'}</h4>
                <dl>
                  {member.angular[kind].map((binding) => (
                    <div key={binding.name}>
                      <dt>
                        <code>{binding.alias}</code>
                        {binding.required ? ' · required' : ''}
                      </dt>
                      <dd>
                        <code>{binding.type}</code>
                        {binding.alias !== binding.name ? (
                          <span>
                            {' '}
                            Property: <code>{binding.name}</code>
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null
          )}
        </section>
      ) : null}
      {member.typeParameters?.length ? (
        <section>
          <h3>Type parameters</h3>
          <dl>
            {member.typeParameters.map((parameter) => (
              <div key={parameter.typeParameterName}>
                <dt>
                  <code>{parameter.typeParameterName}</code>
                </dt>
                <dd>
                  <TypeExcerpt
                    member={member}
                    range={parameter.constraintTokenRange}
                  />
                  {parameter.defaultTypeTokenRange.endIndex >
                  parameter.defaultTypeTokenRange.startIndex ? (
                    <>
                      {' '}
                      Default:{' '}
                      <TypeExcerpt
                        member={member}
                        range={parameter.defaultTypeTokenRange}
                      />
                    </>
                  ) : null}
                  <ApiMarkdown
                    source={
                      docs.typeParams.find(
                        (item) => item.name === parameter.typeParameterName
                      )?.description ?? ''
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {member.parameters?.length ? (
        <section>
          <h3>Parameters</h3>
          <dl>
            {member.parameters.map((parameter) => (
              <div key={parameter.parameterName}>
                <dt>
                  <code>{parameter.parameterName}</code>
                  {parameter.isOptional ? ' · optional' : ' · required'}
                </dt>
                <dd>
                  <TypeExcerpt
                    member={member}
                    range={parameter.parameterTypeTokenRange}
                  />
                  <ApiMarkdown
                    source={
                      docs.params.find(
                        (item) => item.name === parameter.parameterName
                      )?.description ?? ''
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {member.returnTypeTokenRange || docs.returns ? (
        <section>
          <h3>Returns</h3>
          <TypeExcerpt member={member} range={member.returnTypeTokenRange} />
          <ApiMarkdown source={docs.returns} />
        </section>
      ) : null}
      {docs.remarks ? (
        <section>
          <h3>Remarks</h3>
          <ApiMarkdown source={docs.remarks} />
        </section>
      ) : null}
      {docs.examples.length ? (
        <section>
          <h3>Examples</h3>
          {docs.examples.map((example, exampleIndex) => (
            <ApiMarkdown key={exampleIndex} source={example} />
          ))}
        </section>
      ) : null}
      {docs.see.length ? (
        <section>
          <h3>See also</h3>
          {docs.see.map((see, seeIndex) => (
            <ApiMarkdown key={seeIndex} source={see} />
          ))}
        </section>
      ) : null}
      {member.members.length ? (
        <section className="api-reference-members">
          <h3>Members</h3>
          {await Promise.all(
            member.members.map((child, childIndex) =>
              Declaration({ member: child, index: childIndex, nested: true })
            )
          )}
        </section>
      ) : null}
    </section>
  );
}

/** Full symbol detail, preserving every extracted public declaration/overload. */
export async function ApiSymbolView({
  symbol,
  entrypoint,
}: {
  symbol: ApiSymbol;
  entrypoint: ApiEntrypoint;
}) {
  const source = apiSourceUrl(symbol.source);
  const summary = apiSummary(symbol.declarations);
  return (
    <article className="api-reference-detail">
      <div className="api-reference-meta">
        <Link href={`/docs/api/${entrypoint.id}`}>{entrypoint.importPath}</Link>
        <span className="api-reference-badge">{symbol.kind}</span>
        <span className="api-reference-version">v{entrypoint.version}</span>
      </div>
      <h1>{symbol.name}</h1>
      {entrypoint.status === 'development' ? (
        <div className="api-reference-notice">
          <strong>Unpublished development API.</strong> This package is under
          development and is not available as a published release.
        </div>
      ) : null}
      {summary ? (
        <ApiMarkdown source={summary} />
      ) : (
        <p className="api-reference-muted">
          This export has no source documentation yet. Its declaration is shown
          below.
        </p>
      )}
      <div className="api-reference-actions">
        {source ? (
          <a href={source} target="_blank" rel="noreferrer">
            View source
          </a>
        ) : null}
        <a
          href={`/api/markdown/api/${entrypoint.id}/${encodeURIComponent(
            symbol.name
          )}`}
        >
          View Markdown
        </a>
      </div>
      <ApiCode
        tokens={[{ kind: 'Content', text: apiImport(symbol, entrypoint) }]}
      />
      {await Promise.all(
        symbol.declarations.map((member, index) =>
          Declaration({ member, index, pageSummary: summary })
        )
      )}
    </article>
  );
}
