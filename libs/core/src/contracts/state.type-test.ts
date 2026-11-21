import {
  type,
  type AgentSession,
  type AgentSnapshot,
  type InferState,
  type PlainValue,
  type StandardSchemaV1,
  type StateDeclaration,
} from '../index';

interface Todo {
  id: string;
  done: boolean;
  tags?: string[];
}
interface Board {
  todos: Todo[];
  draft?: string;
  owner: { name: string } | null;
}
type Tools = { weather: { args: { city: string }; result: { temp: number } } };

// A declaration carries its state type, whichever form it takes.
const declared = type<Board>();
const fromWitness: InferState<typeof declared> = {
  todos: [],
  owner: null,
};
declare const schema: StandardSchemaV1<unknown, Board>;
const fromSchema: InferState<typeof schema> = { todos: [], owner: null };
const untypedDeclaration: unknown = null as InferState<undefined>;
const either: StateDeclaration<Board>[] = [declared, schema];
// @ts-expect-error a declaration for another shape is not this state's declaration
const wrongDeclaration: StateDeclaration<Board> = type<{ count: number }>();
void [fromWitness, fromSchema, untypedDeclaration, either, wrongDeclaration];

// State must be a plain object with a declared shape.
// @ts-expect-error functions cannot be held in a snapshot
type<{ save: () => void }>();
// @ts-expect-error class instances cannot be held in a snapshot
type<{ at: Date }>();
// @ts-expect-error state is an object, not an array
type<Todo[]>();
// @ts-expect-error state is an object, not a primitive
type<string>();
// @ts-expect-error `unknown` declares nothing
type<unknown>();
type<{ [key: string]: number }>();
type<Record<string, never>>();

// A field may be left open: `unknown` and `PlainValue` are plain data a
// snapshot can hold, at any depth, and so is a type that refers to itself.
interface Outline {
  title: string;
  children: Outline[];
}
interface Loose {
  messages: unknown[];
  files: Record<string, unknown>;
  rows: PlainValue[];
  meta: PlainValue;
  extra?: unknown;
  outline: Outline;
  pair: readonly [string, unknown];
}
const loose = type<Loose>();
type<{ messages: readonly unknown[]; values: readonly PlainValue[] }>();
type<{ nested: { deeper: { rows: PlainValue[]; any: unknown }[] } }>();
type<{ value: PlainValue | { count: number } }>();
// @ts-expect-error a function is not plain data, even beside open fields
type<{ messages: unknown[]; save: () => void }>();
// @ts-expect-error a class instance is not plain data, even inside an open list
type<{ rows: (PlainValue | Date)[] }>();
// @ts-expect-error a function inside a self-referring type is still rejected
type<{ outline: Outline & { visit: () => void } }>();
// An open field reads as plain data, readonly like the rest of the snapshot.
declare const looseSession: AgentSession<Tools, InferState<typeof loose>>;
const looseState = looseSession.getSnapshot().state;
const looseMessage: PlainValue = looseState?.messages[0];
const looseRow: PlainValue = looseState?.rows[0];
const looseTitle: string | undefined = looseState?.outline.children[0]?.title;
if (looseState) {
  // @ts-expect-error open collections are readonly too
  looseState.messages.push('more');
  // @ts-expect-error an open field holds plain data, never a function
  const call: () => void = looseState.meta;
  void call;
}
void looseSession.submit({ message: 'hello', state: { messages: [1, 'two'] } });
void [loose, looseMessage, looseRow, looseTitle];

// The snapshot reads the declared state, deeply readonly.
declare const typed: AgentSession<Tools, Board>;
const state = typed.getSnapshot().state;
const draft: string | undefined = state?.draft;
const firstTag: string | undefined = state?.todos[0]?.tags?.[0];
const owner: string | undefined = state?.owner?.name;
// @ts-expect-error state is absent until the backend reports one
const eager: string = typed.getSnapshot().state.draft;
// @ts-expect-error undeclared keys are not state
const missing = state?.archived;
// @ts-expect-error declared fields keep their type
const wrongType: number | undefined = state?.draft;
if (state) {
  // @ts-expect-error state cannot be replaced
  typed.getSnapshot().state = state;
  // @ts-expect-error state fields are readonly
  state.draft = 'changed';
  // @ts-expect-error nested collections are readonly
  state.todos.push({ id: 't', done: false });
  // @ts-expect-error nested fields are readonly
  state.todos[0].done = true;
}
void [draft, firstTag, owner, eager, missing, wrongType];

// A submission may carry part of the declared state.
void typed.submit('hello');
void typed.submit({ message: 'hello' });
void typed.submit({ message: 'hello', state: { draft: 'x' } });
void typed.submit({ message: 'hello', state: { todos: [], owner: null } });
// @ts-expect-error undeclared keys are not state
void typed.submit({ message: 'hello', state: { archived: true } });
// @ts-expect-error declared fields keep their type
void typed.submit({ message: 'hello', state: { draft: 1 } });
// @ts-expect-error a submission needs its message
void typed.submit({ state: { draft: 'x' } });

// Without a declaration, state is plain data and submissions take any plain record.
declare const untyped: AgentSession;
const plain: PlainValue = untyped.getSnapshot().state;
// @ts-expect-error untyped state has no known fields
const guessed: string = untyped.getSnapshot().state?.draft;
void untyped.submit({ message: 'hello', state: { anything: [1, 'two'] } });
// @ts-expect-error submitted state is plain data
void untyped.submit({ message: 'hello', state: { run: () => 1 } });
void [plain, guessed];

// A typed session is still a session: consumers that take any session accept it.
const observer: AgentSession = typed;
const toolObserver: AgentSession<Tools> = typed;
const snapshotObserver: AgentSnapshot = typed.getSnapshot();
declare const aliasTyped: AgentSession<
  Tools,
  { count: number; label?: string }
>;
const aliasObserver: AgentSession = aliasTyped;
// @ts-expect-error an untyped session does not promise a declared state
const narrowed: AgentSession<Tools, Board> = untyped as AgentSession<Tools>;
void [observer, toolObserver, snapshotObserver, aliasObserver, narrowed];
