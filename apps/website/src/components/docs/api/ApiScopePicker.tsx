'use client';

import { DocsSelect } from '../DocsSelect';
import { API_SCOPES, type ApiScope } from './use-api-scope';

export function ApiScopePicker({
  value,
  onChange,
}: {
  value: ApiScope;
  onChange: (value: ApiScope) => void;
}) {
  return (
    <div className="api-scope-picker">
      <DocsSelect
        label="API scope"
        value={value}
        onChange={onChange}
        options={API_SCOPES}
        apiScope={value}
      />
    </div>
  );
}
