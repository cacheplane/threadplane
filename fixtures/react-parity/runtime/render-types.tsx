import { forwardRef, memo } from 'react';
import {
  RenderSpec,
  type RenderElementData,
  type RenderReadinessEntry,
  type RenderSpecData,
  type RenderViewProps,
  type ReactRenderRegistry,
  type ReactRenderFunctions,
  type RenderComputedFunction,
  type RenderValue,
} from '@threadplane/react/render';
const registry: ReactRenderRegistry = {
  Text: ({ props }) => <p>{String(props['text'])}</p>,
};
const spec = {
  root: 'text',
  elements: { text: { type: 'Text', props: { text: 'Owned', list: [1, 2] } } },
} as const;
export const view = (
  <RenderSpec spec={spec} registry={registry} state={{ count: 1 } as const} />
);
const functions: ReactRenderFunctions = {
  uppercase: ({ value }) => String(value).toUpperCase(),
};
export const computedView = (
  <RenderSpec spec={spec} registry={registry} functions={functions} />
);
export function computedContracts(args: Readonly<Record<string, RenderValue>>) {
  // @ts-expect-error installed callback arguments are readonly
  args['changed'] = 1;
  // @ts-expect-error installed pure functions cannot be asynchronous
  const asynchronous: RenderComputedFunction = async () => 'later';
  // @ts-expect-error installed result values cannot be executable callbacks
  const executable: RenderComputedFunction = () => () => 1;
  return { asynchronous, executable };
}
export function readonlyContracts(
  data: RenderSpecData,
  element: RenderElementData,
  props: RenderViewProps
) {
  // @ts-expect-error raw JSON is not prepared data
  const raw = <RenderSpec spec="{}" registry={registry} />;
  // Commands stay application owned: a spec can call only the handlers listed here.
  const handlers = (
    <RenderSpec
      spec={spec}
      registry={registry}
      handlers={{ save: (params) => params['id'] }}
      onStateChange={(path, value) => void [path, value]}
    />
  );
  // @ts-expect-error handlers are a named map, not one callback
  const single = <RenderSpec spec={spec} registry={registry} handlers={() => 1} />;
  props.emit('press', { id: 1 });
  props.setValue('value', 'next');
  // @ts-expect-error a payload is plain data, not a callback
  props.emit('press', { run: () => 1 });
  // @ts-expect-error source children are readonly
  element.children?.push('new');
  // @ts-expect-error source props are readonly
  element.props['changed'] = 1;
  // @ts-expect-error aggregate data is readonly
  data.root = 'new';
  // @ts-expect-error resolved props are readonly
  props.props['changed'] = 1;
  // @ts-expect-error schema validation is not a renderer capability
  const schema = <RenderSpec spec={spec} registry={registry} schema={{}} />;
  return { raw, handlers, single, schema };
}

const InstalledView = ({ props }: RenderViewProps) => (
  <p>{String(props['value'])}</p>
);
const InstalledMemo = memo(InstalledView);
const InstalledRef = forwardRef<HTMLParagraphElement, RenderViewProps>(
  ({ props }, ref) => <p ref={ref}>{String(props['value'])}</p>
);
const readiness: RenderReadinessEntry = {
  kind: 'readiness',
  component: InstalledMemo,
  fallback: InstalledRef,
  isReady: (props) => {
    // @ts-expect-error contextually typed predicate props are readonly
    props['changed'] = 1;
    return props['value'] !== undefined;
  },
};
export const readinessRegistry: ReactRenderRegistry = {
  DirectMemo: InstalledMemo,
  DirectRef: InstalledRef,
  Ready: readiness,
  RefReady: {
    kind: 'readiness',
    component: InstalledRef,
    fallback: InstalledMemo,
    isReady: (props) => props['value'] !== undefined,
  },
};
export function readinessContracts(config: RenderReadinessEntry) {
  // @ts-expect-error descriptors are readonly
  config.kind = 'readiness';
  // @ts-expect-error synchronous boolean required
  const asynchronous: RenderReadinessEntry['isReady'] = async () => true;
  // @ts-expect-error nonboolean admission is rejected
  const nonboolean: RenderReadinessEntry['isReady'] = () => 'ready';
  return { asynchronous, nonboolean };
}
