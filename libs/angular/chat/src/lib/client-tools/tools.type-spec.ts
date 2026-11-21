import type { Equal, Expect } from '../../testing/type-assert';
import type { FunctionToolDef, ClientToolDef, FunctionToolHandlerContext } from './tool-def';
import { action, tools } from './tools';
import { z } from 'zod/v4';

const moveSchema = z.object({ fromDay: z.number(), placeId: z.string() });

// action() infers handler arg from the schema output and carries the return type R.
const moveAction = action('Move a stop', moveSchema, (a) => a.fromDay + 1);
type _argInfer = Expect<Equal<Parameters<typeof moveAction.handler>[0], { fromDay: number; placeId: string }>>;
type _ctxInfer = Expect<Equal<Parameters<typeof moveAction.handler>[1], FunctionToolHandlerContext>>;
type _retInfer = Expect<Equal<typeof moveAction, FunctionToolDef<typeof moveSchema, number>>>;

// A precise FunctionToolDef must be assignable into the bivariant union.
const _u: ClientToolDef = moveAction;

// tools() preserves per-key tool types AND literal keys under strict.
const registry = tools({
  move_stop: moveAction,
  note: action('Note', z.object({ text: z.string() }), (a) => a.text),
});
type _keys = Expect<Equal<keyof typeof registry, 'move_stop' | 'note'>>;
type _perKey = Expect<Equal<(typeof registry)['move_stop'], FunctionToolDef<typeof moveSchema, number>>>;
