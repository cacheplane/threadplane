import type {
  AgentSnapshot,
  PlainValue,
  ToolContract,
} from '@threadplane/core';

/** Observed backend application data, not a validated application schema. */
export type LangGraphValues = Readonly<Record<string, PlainValue>>;

/** Backend-private extension; the core snapshot remains backend-independent. */
export type LangGraphSnapshot<
  TTools extends { [K in keyof TTools]: ToolContract } = Record<
    string,
    ToolContract
  >
> = AgentSnapshot<TTools> & {
  readonly values: LangGraphValues | undefined;
};
