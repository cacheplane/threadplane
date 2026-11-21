import { type } from '../index';

// Compiled by tsconfig.spec.json (strict) and by
// tsconfig.nonstrict-type-tests.json (`strict: false`), so each declaration
// below holds under both. Without strict null checks `unknown` is assignable
// to a type whose fields are all optional, so a guard that asks only
// "does `unknown` fit?" mistakes that type for an undeclared one.

interface AllOptional {
  topic?: string;
  brief?: string;
}

type<AllOptional>();
type<{ topic: string }>();
type<{ [key: string]: number }>();
// @ts-expect-error `unknown` declares nothing
type<unknown>();
// @ts-expect-error state is an object, not a primitive
type<string>();
// @ts-expect-error state is an object, not an array
type<string[]>();
// @ts-expect-error functions cannot be held in a snapshot
type<{ save: () => void }>();
// @ts-expect-error class instances cannot be held in a snapshot
type<{ at: Date }>();
