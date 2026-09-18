import type { Signal } from '@angular/core';
import type { Equal, Expect } from '../../testing/type-assert';
import type { Agent } from './agent';
import { AgentError } from './agent-error';

type _errTyped = Expect<Equal<Agent['error'], Signal<AgentError | undefined>>>;
type _retry = Expect<Equal<Agent['retry'], () => Promise<void>>>;
type _checkStatus = Expect<Equal<Agent['checkStatus'], (() => Promise<void>) | undefined>>;
const _isErr: Error = new AgentError({ kind: 'server', message: 'x', retryable: true });
export { _isErr };
