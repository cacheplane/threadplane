import {
  RenderSpec,
  type RenderElementData,
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
  // @ts-expect-error commands remain application owned
  const handlers = <RenderSpec spec={spec} registry={registry} handlers={{}} />;
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
  return { raw, handlers, schema };
}
