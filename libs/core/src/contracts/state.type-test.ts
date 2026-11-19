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
