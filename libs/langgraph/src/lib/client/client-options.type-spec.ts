import type { Equal, Expect } from '../../testing/type-assert';
import type { LangGraphClientOptions } from '../agent.types';

// The browser adapter offers no field for a deployment credential. A key
// passed from Angular ships in the bundle, so `apiKey` must not compile.
// @ts-expect-error apiKey is not a LangGraphClientOptions member
const rejected: LangGraphClientOptions = { apiKey: 'lsv2_must_not_compile' };
export type { rejected };

// What the options do carry: a retry budget and per-request headers for a
// per-user session token that LangGraph custom auth validates.
type _keys = Expect<Equal<keyof LangGraphClientOptions, 'defaultHeaders' | 'maxRetries'>>;
type _headers = Expect<
  Equal<LangGraphClientOptions['defaultHeaders'], Record<string, string> | undefined>
>;
export type { _keys, _headers };
