import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChatInput,
  Welcome,
  WelcomeSuggestion,
  type ChatInputHandle,
} from '@threadplane/react/chat';
import type {
  ReactApplication as Application,
  ReactApplicationSnapshot as ApplicationSnapshot,
} from './application';
import { submissionStatus } from '../../shared/submission-status';

const suggestions = [
  { label: 'Plan a weekend trip', value: 'Help me plan a weekend trip.' },
  {
    label: 'Explain a topic',
    value: 'Help me understand a topic step by step.',
  },
] as const;

function deletionBlocked(snapshot: ApplicationSnapshot) {
  return (
    snapshot.deletion.id === snapshot.selection.id &&
    (snapshot.deletion.status === 'pending' ||
      snapshot.deletion.status === 'unconfirmed')
  );
}

function welcomeEligible(snapshot: ApplicationSnapshot) {
  return (
    snapshot.selection.status === 'ready' &&
    snapshot.selection.id !== null &&
    snapshot.runtime?.status === 'idle' &&
    !snapshot.runtime.error &&
    !snapshot.runtime.reconnect &&
    snapshot.runtime.messages.length === 0 &&
    snapshot.messages.length === 0 &&
    !snapshot.submission.active &&
    !deletionBlocked(snapshot)
  );
}

export function NativeComposer({
  application,
  snapshot,
}: {
  application: Application;
  snapshot: ApplicationSnapshot;
}) {
  const [draft, setDraft] = useState('');
  const liveDraft = useRef('');
  const input = useRef<ChatInputHandle>(null);
  const active = snapshot.submission.active;
  const canSubmit = application.canSubmit();
  const eligible = welcomeEligible(snapshot) && canSubmit;
  const threadId = snapshot.selection.id;
  // Each committed owner/eligibility occurrence expires the preceding controls,
  // including A-B-A transitions, while ordinary renders retain their scope.
  const scope = useMemo(() => ({}), [application, threadId, eligible]);
  const committed = useRef<object | null>(null);
  useLayoutEffect(() => {
    committed.current = scope;
    return () => {
      if (committed.current === scope) committed.current = null;
    };
  }, [scope]);

  const changeDraft = (value: string) => {
    liveDraft.current = value;
    setDraft(value);
  };
  const selectSuggestion = (value: string) => {
    if (!eligible || committed.current !== scope || liveDraft.current !== '')
      return;
    const current = application.getSnapshot();
    if (
      current.selection.id !== threadId ||
      !welcomeEligible(current) ||
      !application.canSubmit()
    )
      return;
    // Capability checks can read the runtime. Revalidate after that boundary.
    const latest = application.getSnapshot();
    if (
      committed.current !== scope ||
      liveDraft.current !== '' ||
      latest.selection.id !== threadId ||
      !welcomeEligible(latest)
    )
      return;
    changeDraft(value);
    input.current?.focus();
  };

  return (
    <div className="composer">
      <Welcome
        className={`native-react-welcome${
          eligible ? '' : ' native-react-welcome--plain'
        }`}
        title={eligible ? undefined : null}
        suggestions={
          eligible ? (
            <>
              <p className="muted">
                Choose a suggestion to fill your draft. Review it before
                pressing Send.
              </p>
              {suggestions.map((suggestion) => (
                <WelcomeSuggestion
                  key={suggestion.label}
                  {...suggestion}
                  disabled={draft.length > 0}
                  onSelect={selectSuggestion}
                />
              ))}
            </>
          ) : null
        }
      >
        <ChatInput
          ref={input}
          value={draft}
          onValueChange={changeDraft}
          id="message"
          label="Message"
          placeholder="Write a message…"
          hint="Ctrl or ⌘ + Enter to send. Enter adds a line."
          submitOnEnter={false}
          disabled={
            snapshot.selection.status !== 'ready' ||
            active ||
            deletionBlocked(snapshot)
          }
          busy={active || !canSubmit}
          onStop={active ? () => void application.stop() : undefined}
          onSubmit={(text) =>
            application.canSubmit() && application.submit(text)
          }
        />
      </Welcome>
      <p className="submission-status" role="status">
        {submissionStatus(snapshot)}
      </p>
    </div>
  );
}
