import type { AgentSession } from '@threadplane/core';
import type { Session } from './create-session';
import type { ApplicationState, SubmitInput } from './submit-input';

declare const owner: Session;
declare const core: AgentSession;
const state = {
  settings: { levels: [1, null, undefined] },
  messages: ['payload'],
  constructor: 'payload',
} as const;
const patch: ApplicationState = state;
const input: SubmitInput = { message: 'text', state: patch };
void owner.submit('');
void owner.submit(input);
void owner.submit(
  { message: 'text' },
  { signal: new AbortController().signal }
);
void owner.submit({ message: 'text', state: undefined });
// @ts-expect-error message is required
void owner.submit({ state: {} });
// @ts-expect-error message must be literal text
void owner.submit({ message: 1 });
// @ts-expect-error application state must be a record
void owner.submit({ message: 'text', state: [] });
// @ts-expect-error application state cannot be null
void owner.submit({ message: 'text', state: null });
// @ts-expect-error functions are not plain data
void owner.submit({ message: 'text', state: { callback: () => 1 } });
// @ts-expect-error Date instances are not plain data
void owner.submit({ message: 'text', state: { date: new Date() } });
// @ts-expect-error transport configuration is not submit input
void owner.submit({ message: 'text', threadId: 'override' });
// @ts-expect-error protocol history is not authored submit input
void owner.submit({ message: 'text', messages: [] });
// @ts-expect-error forwarded properties are not authored submit input
void owner.submit({ message: 'text', forwardedProps: {} });
// @ts-expect-error tool catalogs are not authored submit input
void owner.submit({ message: 'text', tools: [] });
// @ts-expect-error signal belongs to options
void owner.submit({ message: 'text', signal: new AbortController().signal });
// @ts-expect-error captured authored state is readonly
patch['settings'] = {};
// @ts-expect-error core intentionally retains its string-only submit contract
void core.submit({ message: 'text', state: {} });
