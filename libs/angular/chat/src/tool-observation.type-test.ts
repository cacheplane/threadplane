import { ToolObservationComponent } from './public-api';
type Inputs = {
  readonly name: ReturnType<ToolObservationComponent['name']>;
  readonly argumentsText: ReturnType<ToolObservationComponent['argumentsText']>;
  readonly resultText?: ReturnType<ToolObservationComponent['resultText']>;
  readonly label?: ReturnType<ToolObservationComponent['label']>;
};
const props: Inputs = {
  name: 'weather',
  argumentsText: '{"city":',
  resultText: '',
  label: 'Worker',
};
// @ts-expect-error The display inputs remain readonly.
props.argumentsText = 'changed';
// @ts-expect-error Name is required.
const missingName: Inputs = { argumentsText: '' };
// @ts-expect-error Arguments text is required.
const missingArgs: Inputs = { name: 'weather' };
// @ts-expect-error Structured arguments belong to caller formatting.
const object: Inputs = { name: 'weather', argumentsText: {} };
// @ts-expect-error Result must be literal text.
const number: Inputs = { name: 'weather', argumentsText: '', resultText: 1 };
const callback: Inputs = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error Execution callbacks are not display inputs.
  execute: () => undefined,
};
const status: Inputs = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error There is no execution status input.
  status: 'running',
};
// @ts-expect-error Sessions do not belong to the display contract.
const session: Inputs = { name: 'weather', argumentsText: '', session: {} };
declare const component: ToolObservationComponent;
// @ts-expect-error Required input signals cannot be replaced.
component.name = component.argumentsText;
export const contracts = [
  props,
  missingName,
  missingArgs,
  object,
  number,
  callback,
  status,
  session,
];
