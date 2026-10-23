// Compile-only: the installed test runner executes only *.spec.js files.
import { createApplication, type ApplicationOptions } from './application.js';
import {
  createMessageContent,
  type MessageContent,
} from './message-content.js';

interface EnrichedRow extends MessageContent {
  readonly enriched: string;
}
declare const options: ApplicationOptions;
const ordinary = createApplication(options);
const ordinaryRow: MessageContent = ordinary.getSnapshot().messages[0];
// @ts-expect-error Default rows do not have enriched fields.
ordinaryRow.enriched;

const enrichedFactory = () => {
  const content = createMessageContent();
  return {
    ...content,
    getSnapshot: () =>
      content.getSnapshot().map((row) => ({ ...row, enriched: 'yes' })),
  };
};
const inferred = createApplication({
  ...options,
  contentFactory: enrichedFactory,
});
const enriched: string = inferred.getSnapshot().messages[0].enriched;
// @ts-expect-error Inference preserves the field type rather than widening to any.
const wrongField: number = inferred.getSnapshot().messages[0].enriched;
const explicit = createApplication<EnrichedRow>({
  ...options,
  contentFactory: enrichedFactory,
});
const explicitField: string = explicit.getSnapshot().messages[0].enriched;
// @ts-expect-error An explicit enriched type requires a matching factory.
createApplication<EnrichedRow>(options);
createApplication<EnrichedRow>({
  ...options,
  // @ts-expect-error Ordinary content cannot satisfy an enriched row contract.
  contentFactory: createMessageContent,
});
// @ts-expect-error Content rows must retain the shared message content contract.
createApplication({
  ...options,
  contentFactory: () => ({
    getSnapshot: () => [{ enriched: 'bad' }],
    update() {},
    dispose() {},
  }),
});
void [enriched, explicitField];
