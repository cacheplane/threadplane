import { createRoot } from 'react-dom/client';
import { act } from 'react';
import { expect, it } from 'vitest';
import { createMessageContent } from '@threadplane/content/messages';
import { renderMessage } from './app';

it('composes labelled user, system and assistant articles with owned Markdown, hiding tool rows', async () => {
  const content = createMessageContent();
  const rows = content.project({
    status: 'idle',
    toolCalls: [],
    messages: [
      { id: 'u', role: 'user', content: 'Question' },
      { id: 's', role: 'system', content: 'System context' },
      {
        id: 'a',
        role: 'assistant',
        content: '```typescript\nconst answer = 42;\n```',
      },
      { id: 't', role: 'tool', content: 'Hidden tool result' },
    ].map((m) => ({
      ...m,
      role: m.role as 'user' | 'system' | 'assistant' | 'tool',
      delivery: { generation: m.id, phase: 'complete', outcome: 'success' },
    })),
  });
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        <>
          {rows.map((row) => (
            <div key={row.id}>{renderMessage(row)}</div>
          ))}
        </>
      )
    );
    expect(container.querySelectorAll('article')).toHaveLength(3);
    expect(
      Array.from(container.querySelectorAll('article')).map((el) =>
        el.getAttribute('aria-label')
      )
    ).toEqual(['You', 'System', 'Assistant']);
    expect(container.querySelector('pre code')?.textContent).toBe(
      'const answer = 42;'
    );
    expect(container.textContent).not.toContain('Hidden tool result');
  } finally {
    await act(async () => root.unmount());
    container.remove();
    content.dispose();
  }
});
