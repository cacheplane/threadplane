import {
  createSession,
  type ClientToolSession,
  type Session,
  type SessionOptions,
} from './create-session';
import type { ClientToolCall } from './client-tools';

declare const options: SessionOptions;
const catalog = {
  weather: {
    description: 'weather',
    handler: (args: { city: string; units?: 'C' | 'F' }) => ({
      temperatures: [args.city.length],
    }),
  },
  book: {
    description: 'book',
    handler: async (args: { seats: number }) => ({
      confirmation: String(args.seats),
    }),
  },
};
const owner = createSession(options, catalog);
const plain: Session = createSession(options);
// @ts-expect-error plain owners expose no local execution projection
void plain.getSnapshot().clientTools;
// @ts-expect-error catalog is not an options field
createSession({ ...options, tools: catalog });
for (const call of owner.getSnapshot().clientTools.calls) {
  const name: 'weather' | 'book' = call.name;
  void name;
  if (call.name === 'weather') {
    const city: string | undefined = call.args?.city;
    const temperatures: readonly number[] | undefined =
      call.result?.temperatures;
    void city;
    void temperatures;
    // @ts-expect-error heterogeneous result stays narrowed
    void call.result?.confirmation;
    // @ts-expect-error authored nested arguments are readonly
    if (call.args) call.args.city = 'changed';
    // @ts-expect-error authored nested results are readonly
    call.result?.temperatures.push(3);
  } else {
    const seats: number | undefined = call.args?.seats;
    const confirmation: string | undefined = call.result?.confirmation;
    void seats;
    void confirmation;
    // @ts-expect-error heterogeneous arguments stay narrowed
    void call.args?.city;
  }
  // @ts-expect-error local call fields are readonly
  call.delivery = 'observed';
}
// @ts-expect-error snapshot calls cannot be mutated
owner.getSnapshot().clientTools.calls.push({});
const empty = createSession(options, {});
const impossible: readonly never[] = empty.getSnapshot().clientTools.calls;
void impossible;
const declared: ClientToolSession<{
  weather: { args: { city: string }; result: { temperatures: number[] } };
}> = createSession(options, { weather: catalog.weather });
void declared;
const malformed: ClientToolCall<{
  weather: { args: { city: string }; result: number };
}> = {
  name: 'weather',
  callId: 'call',
  assistantMessageId: 'assistant',
  sourceRunId: 'run',
  rawArguments: '{',
  status: 'error',
  delivery: 'unsent',
  provenance: 'local',
  error: 'invalid JSON',
};
// @ts-expect-error malformed JSON has no required decoded arguments
const required: { readonly args: { readonly city: string } } = malformed;
void required;
// @ts-expect-error optional arguments still enforce authored field types
const wrong: typeof malformed = { ...malformed, args: { city: 1 } };
void wrong;
createSession(options, {
  // @ts-expect-error inferred functions are not portable arguments
  bad: {
    description: '',
    handler: (args: { callback: () => void }) => args.callback(),
  },
});
createSession(options, {
  // @ts-expect-error inferred functions are not portable results
  bad: {
    description: '',
    handler: (args: { city: string }) => () => args.city,
  },
});
