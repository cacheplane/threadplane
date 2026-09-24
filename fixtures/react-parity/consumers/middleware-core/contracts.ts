import type {
  ToolExecutionKey,
  ToolExecutionAcquisition,
  ToolExecutionSettlement,
  ToolExecutionStore,
} from '@threadplane/core/tools';
import type {
  ClientToolExecutionKey,
  ClientToolExecutionAcquisition,
  ClientToolExecutionSettlement,
  ClientToolExecutionStore,
} from '@threadplane/middleware/langgraph';

declare const coreKey: ToolExecutionKey;
declare const middlewareKey: ClientToolExecutionKey;
const keyToCore: ToolExecutionKey = middlewareKey;
const keyToMiddleware: ClientToolExecutionKey = coreKey;
declare const coreAcquisition: ToolExecutionAcquisition;
declare const middlewareAcquisition: ClientToolExecutionAcquisition;
const acquisitionToCore: ToolExecutionAcquisition = middlewareAcquisition;
const acquisitionToMiddleware: ClientToolExecutionAcquisition = coreAcquisition;
declare const coreSettlement: ToolExecutionSettlement;
declare const middlewareSettlement: ClientToolExecutionSettlement;
const settlementToCore: ToolExecutionSettlement = middlewareSettlement;
const settlementToMiddleware: ClientToolExecutionSettlement = coreSettlement;
declare const coreStore: ToolExecutionStore;
declare const middlewareStore: ClientToolExecutionStore;
const storeToCore: ToolExecutionStore = middlewareStore;
const storeToMiddleware: ClientToolExecutionStore = coreStore;
const old = {
  claim: async () => 'claimed' as const,
  record: async () => undefined,
};
// @ts-expect-error the old port grants no durable ownership
const oldCore: ToolExecutionStore = old;
// @ts-expect-error the old port grants no durable ownership
const oldMiddleware: ClientToolExecutionStore = old;
void [
  keyToCore,
  keyToMiddleware,
  acquisitionToCore,
  acquisitionToMiddleware,
  settlementToCore,
  settlementToMiddleware,
  storeToCore,
  storeToMiddleware,
  oldCore,
  oldMiddleware,
];
