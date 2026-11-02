import { StateDiff, type StateDiffProps, type DebugValue } from './index';
const value: DebugValue = { list: [null, false, 2, 'literal'] };
const props: StateDiffProps = {
  before: value,
  after: {},
  label: 'Changes',
  className: 'custom',
};
const view = <StateDiff {...props} />;
// @ts-expect-error Both supplied states are required.
const missing = <StateDiff before={value} />;
// @ts-expect-error Undefined is unavailable, not a supplied state.
const unavailable = <StateDiff before={undefined} after={{}} />;
// @ts-expect-error Runtime objects are not plain JSON.
const runtime = <StateDiff before={new Date()} after={{}} />;
// @ts-expect-error Passive comparison has no reader.
const read = <StateDiff {...props} onRefresh={() => undefined} />;
// @ts-expect-error Passive comparison has no session capability.
const session = <StateDiff {...props} session={{}} />;
// @ts-expect-error Labels are strings.
const label = <StateDiff {...props} label={2} />;
// @ts-expect-error Supplied state is readonly.
props.before = {};
// @ts-expect-error Supplied state is readonly.
props.after = {};
// @ts-expect-error Label is readonly.
props.label = 'Changed';
// @ts-expect-error Class is readonly.
props.className = 'changed';
type Keys = keyof StateDiffProps;
const exactKeys: Record<Keys, true> = {
  before: true,
  after: true,
  label: true,
  className: true,
};
void [view, missing, unavailable, runtime, read, session, label, exactKeys];
