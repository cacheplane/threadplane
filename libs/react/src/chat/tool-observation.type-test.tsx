import { ToolObservation, type ToolObservationProps } from './index';
const props: ToolObservationProps = {
  name: 'weather',
  argumentsText: '{"city":',
  resultText: '',
  label: 'Worker',
};
// @ts-expect-error Props are readonly.
props.argumentsText = 'changed';
// @ts-expect-error Name is required.
const missingName: ToolObservationProps = { argumentsText: '' };
// @ts-expect-error Arguments text is required.
const missingArgs: ToolObservationProps = { name: 'weather' };
// @ts-expect-error Structured arguments belong to caller formatting.
const object: ToolObservationProps = { name: 'weather', argumentsText: {} };
const number: ToolObservationProps = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error Result must be literal text.
  resultText: 1,
};
const callback: ToolObservationProps = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error Execution callbacks are not display inputs.
  execute: () => undefined,
};
const status: ToolObservationProps = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error Status is not inferred or supplied by this component.
  status: 'running',
};
const session: ToolObservationProps = {
  name: 'weather',
  argumentsText: '',
  // @ts-expect-error Sessions do not belong to the display contract.
  session: {},
};
export const contracts = [
  <ToolObservation {...props} />,
  <ToolObservation name="weather" argumentsText="null" />,
  missingName,
  missingArgs,
  object,
  number,
  callback,
  status,
  session,
];
