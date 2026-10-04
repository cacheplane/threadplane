import type {
  RenderElementData,
  RenderSpecData,
  RenderSpecProps,
  RenderViewProps,
  ReactRenderRegistry,
  ReactRenderFunctions,
  RenderComputedFunction,
  RenderValue,
} from './index.js';
import { RenderSpec } from './index.js';
import type { Json } from '@threadplane/content/json';

const spec = {
  root: 'root',
  elements: {
    root: {
      type: 'Text',
      props: { text: 'Literal', nested: { list: [1] } },
      children: [],
    },
  },
} as const;
const registry: ReactRenderRegistry = {
  Text: ({ props }) => String(props['text']),
};
RenderSpec({ spec, registry, state: { count: 1 } as const });
const functions: ReactRenderFunctions = {
  uppercase: ({ value }) => String(value).toUpperCase(),
};
RenderSpec({ spec, registry, functions });

export function computedContracts(
  args: Readonly<Record<string, RenderValue>>,
  map: ReactRenderFunctions
) {
  // @ts-expect-error computed arguments are owned readonly data
  args['changed'] = 1;
  // @ts-expect-error the caller function map is readonly
  map['changed'] = () => 1;
  const values = args['values'];
  if (Array.isArray(values)) {
    // Array.isArray narrows readonly arrays to mutable any[]; use the contract type.
    const owned = values as readonly RenderValue[];
    // @ts-expect-error nested computed argument arrays are readonly
    owned.push(1);
  }
  // @ts-expect-error pure computations cannot return promises
  const asynchronous: RenderComputedFunction = async () => 'later';
  // @ts-expect-error computed results cannot be executable callbacks
  const executable: RenderComputedFunction = () => () => 1;
  // @ts-expect-error a raw callback is not a function map
  const invalid: ReactRenderFunctions = () => 1;
  return { asynchronous, executable, invalid };
}

export function readonlyContracts(
  data: RenderSpecData,
  element: RenderElementData,
  props: RenderViewProps,
  owner: Json
) {
  // @ts-expect-error caller data is readonly
  data.root = 'new';
  // @ts-expect-error nested raw props are readonly
  element.props['new'] = 1;
  // @ts-expect-error children are readonly
  element.children?.push('new');
  // @ts-expect-error view props are readonly
  props.props['new'] = 1;
  const value = props.props['nested'];
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    // @ts-expect-error recursively owned output is readonly
    value['new'] = 1;
  }
  // @ts-expect-error parser owners are not prepared trees
  RenderSpec({ spec: owner, registry });
  // @ts-expect-error raw JSON text is not a prepared tree
  RenderSpec({ spec: '{}', registry });
  const callback: RenderElementData = {
    type: 'Text',
    // @ts-expect-error raw props carry JSON data, not executable callbacks
    props: { callback: () => 1 },
  };
  // @ts-expect-error actions are not automatic renderer capabilities
  const handlers: RenderSpecProps = { spec, registry, handlers: {} };
  // @ts-expect-error schema validation is caller owned
  const schema: RenderSpecProps = { spec, registry, schema: {} };
  // @ts-expect-error view does not execute spec events
  props.emit('press');
  return { callback, handlers, schema };
}
