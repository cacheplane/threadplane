import type {
  RenderElementData,
  RenderSpecData,
  RenderSpecProps,
  RenderViewProps,
  ReactRenderRegistry,
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
