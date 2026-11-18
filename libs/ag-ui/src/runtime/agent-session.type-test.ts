import {
  type,
  type AgentSession,
  type StandardSchemaV1,
  type ToolContract,
} from '@threadplane/core';
import { createSession } from './create-session';

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B
  ? 1
  : 2
  ? true
  : false;
type Assert<T extends true> = T;
interface Draft {
  title: string;
  tags: string[];
  note?: string;
}
declare const schema: StandardSchemaV1<unknown, Draft>;
const options = { threadId: 't', url: 'https://agent.invalid' };

// The session is a core session. Without a declaration its state is plain
// data and any record can be sent.
const untyped = createSession(options);
const anySession: AgentSession = untyped;
void anySession;
void untyped.submit({ message: 'Go', state: { anything: [1, null] } });
// @ts-expect-error Plain data has no known keys.
void untyped.getSnapshot().state?.title;
// The protocol evidence stays on the snapshot beside the core fields.
const evidence = untyped.getSnapshot();
void evidence.transcript;
void evidence.messages;
void evidence.decision;
// @ts-expect-error A core observer sees the core snapshot only.
void anySession.getSnapshot().transcript;

// type<T>() declares the state.
const typed = createSession({ ...options, stateType: type<Draft>() });
export type TypedState = Assert<
  Equal<
    ReturnType<typeof typed.getSnapshot>['state'],
    | {
        readonly title: string;
        readonly tags: readonly string[];
        readonly note?: string;
      }
    | undefined
  >
>;
const core: AgentSession<Record<string, ToolContract>, Draft> = typed;
void core;
const issues: readonly string[] | undefined = typed.getSnapshot().stateIssues;
void issues;
void typed.submit({ message: 'Go', state: { title: 'New' } });
void typed.submit('Go');
// @ts-expect-error A submitted state holds declared keys only.
void typed.submit({ message: 'Go', state: { unknownKey: 1 } });
// @ts-expect-error A declared key keeps its type.
void typed.submit({ message: 'Go', state: { title: 1 } });
// @ts-expect-error State is read-only.
typed.getSnapshot().state?.tags.push('x');

// A Standard Schema declares the same type from its output.
const checked = createSession({ ...options, stateType: schema });
export type CheckedState = Assert<
  Equal<
    NonNullable<ReturnType<typeof checked.getSnapshot>['state']>['title'],
    string
  >
>;

// The client-tool owner is a core session with the declaration too.
const tools = createSession({ ...options, stateType: type<Draft>() }, {});
const toolCore: AgentSession<Record<string, ToolContract>, Draft> = tools;
void toolCore;
void tools.getSnapshot().clientTools.calls;
void tools.submit({ message: 'Go', state: { tags: [] } });
// @ts-expect-error A submitted state holds declared keys only.
void tools.submit({ message: 'Go', state: { unknownKey: 1 } });
