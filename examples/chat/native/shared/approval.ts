export interface Approval {
  readonly id: string;
  readonly reason: string;
}

/** Private policy for the canonical chat graph, not a general interrupt schema. */
export function projectApproval(
  interrupts: readonly { readonly id?: unknown; readonly value?: unknown }[]
): Approval | null {
  if (interrupts.length !== 1) return null;
  const { id, value } = interrupts[0];
  if (
    typeof id !== 'string' ||
    !/^[0-9a-f]{32}$/.test(id) ||
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('type' in value) ||
    value.type !== 'approval_request' ||
    !('reason' in value) ||
    typeof value.reason !== 'string' ||
    !value.reason.length
  )
    return null;
  return Object.freeze({ id, reason: value.reason });
}
