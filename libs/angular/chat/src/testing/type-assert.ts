/**
 * Compile-time type-assertion helpers.
 *
 * Usage:
 *   type _check = Expect<Equal<ActualType, ExpectedType>>;
 *
 * The assertion is enforced purely at compile time — no runtime code is emitted.
 */

/** Resolves to `true` only when A and B are mutually assignable (i.e. identical). */
export type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2)
    ? true
    : false;

/** Causes a compile error when T is not `true`. */
export type Expect<T extends true> = T;

/** True if `A` is assignable to `B`. */
export type Assignable<A, B> = A extends B ? true : false;
