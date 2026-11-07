import { RenderSpec, type ReactRenderRegistry,
  type RenderSpecData } from '@threadplane/react/render';

// Source-build profile; a literal, application-authored specification.
const registry: ReactRenderRegistry = {
  Text: ({ props }) => <p>{
    typeof props.label === 'string' ? props.label : 'Unavailable'
  }</p>,
};
const spec: RenderSpecData = {
  root: 'greeting',
  elements: {
    greeting: { type: 'Text', props: { label: 'Hello, React.' } },
  },
};

export function GeneratedView() {
  return <RenderSpec spec={spec} registry={registry} />;
}
