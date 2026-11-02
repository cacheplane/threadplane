import { useRef } from 'react';
import { OverflowMenu } from '@threadplane/react/chat';
import type { NativeProject } from './project-catalog';

/** Keeps the app command invoker anchored to the persistent row button. */
export function NativeProjectActions({
  project,
  disabled,
  open,
  canDelete,
  onOpenChange,
  onAction,
}: {
  readonly project: NativeProject;
  readonly disabled: boolean;
  readonly open: boolean;
  readonly canDelete: boolean | undefined;
  readonly onOpenChange: (open: boolean) => void;
  readonly onAction: (
    action: 'rename' | 'delete',
    invoker: HTMLButtonElement
  ) => void;
}) {
  const wrapper = useRef<HTMLSpanElement>(null);
  return (
    <span ref={wrapper}>
      <OverflowMenu
        label={`More actions for project ${project.name} (${project.id})`}
        disabled={disabled}
        open={open}
        onOpenChange={onOpenChange}
        items={[
          { id: 'rename', label: 'Rename' },
          ...(canDelete === undefined
            ? []
            : [
                {
                  id: 'delete',
                  label: 'Delete',
                  disabled: !canDelete,
                  tone: 'destructive' as const,
                },
              ]),
        ]}
        onSelect={(action) => {
          const invoker = wrapper.current?.querySelector<HTMLButtonElement>(
            'button[aria-haspopup="menu"]'
          );
          if (invoker && (action === 'rename' || action === 'delete'))
            onAction(action, invoker);
        }}
      />
    </span>
  );
}
