import {
  ApprovalCard,
  type ApprovalCardAction,
  type ApprovalCardProps,
} from './index.js';
const action: ApprovalCardAction = {
  id: 'approve',
  label: 'Approve',
  onSelect: () => true,
};
const props: ApprovalCardProps = {
  children: 'Supplied reason',
  actions: [action],
  disabled: false,
};
<ApprovalCard {...props} />;
<ApprovalCard
  actions={[
    {
      id: 'edit',
      label: 'Edit',
      onSelect: async () => {
        /* Caller handles completion/errors. */
      },
    },
  ]}
>
  <input />
</ApprovalCard>;
// @ts-expect-error Actions are explicit and required.
<ApprovalCard>Reason</ApprovalCard>;
// @ts-expect-error Body must be a React node, not an unprojected SDK object.
<ApprovalCard actions={[action]}>{{ reason: 'raw' }}</ApprovalCard>;
const invalid: ApprovalCardAction = {
  id: 'x',
  label: 'X',
  // @ts-expect-error Action callbacks do not receive inferred interrupt payloads.
  onSelect: (payload: string) => payload,
};
// @ts-expect-error Action fields are readonly.
action.label = 'Changed';
// @ts-expect-error Collections are readonly.
props.actions.push(action);
// @ts-expect-error Authoritative disabled state is readonly.
props.disabled = true;
void invalid;
