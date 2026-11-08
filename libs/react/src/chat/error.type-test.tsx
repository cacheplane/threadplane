import type { AgentError } from '@threadplane/core';
import { ChatError, type ChatErrorProps } from './index';
declare const error: AgentError;
<ChatError
  error={error}
  onRetry={() => undefined}
  onCheckStatus={() => undefined}
  disabled
  className="mine"
/>;
<ChatError error={null} />;
<ChatError error={undefined} />;
// @ts-expect-error A nullable error is still required.
<ChatError />;
// @ts-expect-error No unknown-error coercion.
<ChatError error={new Error('raw')} />;
// @ts-expect-error No owner/session props.
<ChatError error={error} session={{}} />;
// @ts-expect-error No commands owner.
<ChatError error={error} commands={{}} />;
// @ts-expect-error No owner.
<ChatError error={error} owner={{}} />;
// @ts-expect-error Intents take zero arguments.
<ChatError error={error} onRetry={(payload: string) => undefined} />;
// @ts-expect-error Intents take zero arguments.
<ChatError error={error} onCheckStatus={(owner: object) => undefined} />;
const props: ChatErrorProps = { error };
// @ts-expect-error Props are readonly.
props.error = null;
// @ts-expect-error Props are readonly.
props.onRetry = () => undefined;
// @ts-expect-error Borrowed error stays readonly.
error.message = 'changed';
