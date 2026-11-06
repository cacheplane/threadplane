import type { Citation } from '@threadplane/core';
import { CitationPreview } from '@threadplane/react/chat';

function NativeSourceCard({ citation }: { readonly citation: Citation }) {
  return (
    <div
      className="native-source-card"
      data-source-id={citation.id}
      style={{
        display: 'grid',
        minWidth: 0,
        gap: '0.375rem',
        padding: '0.75rem',
        overflowWrap: 'anywhere',
        color: 'var(--tp-chat-text, var(--ds-text-primary, CanvasText))',
        background: 'var(--tp-chat-surface, var(--ds-surface, Canvas))',
        border: '1px solid var(--tp-chat-border, var(--ds-border, GrayText))',
        borderRadius: 'var(--tp-chat-radius-card, 0.5rem)',
      }}
    >
      <CitationPreview citation={citation} />
      {citation.sourceType !== undefined && (
        <small className="native-source-card__type">
          Source type: {citation.sourceType}
        </small>
      )}
    </div>
  );
}

export function renderNativeSourceCard(citation: Citation) {
  return <NativeSourceCard citation={citation} />;
}
