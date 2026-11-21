/**
 * @internal
 * Identity mapped type that flattens an object type so editor quick-info shows
 * the expanded shape instead of a raw conditional/mapped-type expression.
 */
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
