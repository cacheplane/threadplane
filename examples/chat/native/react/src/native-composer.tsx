import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChatInput,
  Suggestions,
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

const followups = [
  { id: 'concise', label: 'Make it shorter', value: 'Make that more concise.' },
  {
    id: 'example',
    label: 'Give an example',
    value: 'Give me a concrete example.',
  },
] as const;

function deletionBlocked(snapshot: ApplicationSnapshot) {
  return (
    snapshot.deletion.id === snapshot.selection.id &&
    (snapshot.deletion.status === 'pending' ||
      snapshot.deletion.status === 'unconfirmed')
  );
}

function suggestionMode(snapshot: ApplicationSnapshot) {
  const runtime = snapshot.runtime;
  if (
    !(
      snapshot.selection.status === 'ready' &&
      snapshot.selection.id !== null &&
      runtime?.status === 'idle' &&
      !runtime.error &&
      !runtime.reconnect &&
      !snapshot.submission.active &&
      !deletionBlocked(snapshot)
    )
  )
    return null;
  if (runtime.messages.length === 0 && snapshot.messages.length === 0)
    return 'welcome';
  if (
    snapshot.submissionKind === 'text' &&
    snapshot.submission.outcome === 'success' &&
    runtime.messages.some((message) => message.role === 'assistant') &&
    snapshot.messages.some((row) => row.message.role === 'assistant')
  )
    return 'followup';
  return null;
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
  const mode = canSubmit ? suggestionMode(snapshot) : null;
  const eligible = mode !== null;
  const threadId = snapshot.selection.id;
  // Each committed owner/eligibility occurrence expires the preceding controls,
  // including A-B-A transitions, while ordinary renders retain their scope.
  const submission = snapshot.submission;
  const scope = useMemo(() => ({}), [application, threadId, mode, submission]);
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
      current.submission !== submission ||
      suggestionMode(current) !== mode ||
      !application.canSubmit()
    )
      return;
    // Capability checks can read the runtime. Revalidate after that boundary.
    const latest = application.getSnapshot();
    if (
      committed.current !== scope ||
      liveDraft.current !== '' ||
      latest.selection.id !== threadId ||
      latest.submission !== submission ||
      suggestionMode(latest) !== mode
    )
      return;
    changeDraft(value);
    input.current?.focus();
  };

  return (
    <div className="composer">
      <Welcome
        className={`native-react-welcome${
          mode === 'welcome' ? '' : ' native-react-welcome--plain'
        }`}
        title={mode === 'welcome' ? undefined : null}
        suggestions={
          eligible ? (
            <>
              <p className="muted">
                Choose a suggestion to fill your draft. Review it before
                pressing Send.
              </p>
              {mode === 'followup' ? (
                <Suggestions
                  suggestions={followups}
                  disabled={draft.length > 0}
                  onSelect={selectSuggestion}
                />
              ) : (
                suggestions.map((suggestion) => (
                  <WelcomeSuggestion
                    key={suggestion.label}
                    {...suggestion}
                    disabled={draft.length > 0}
                    onSelect={selectSuggestion}
                  />
                ))
              )}
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
            snapshot.selection.status !== 'ready' || deletionBlocked(snapshot)
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
