'use client';
import Link from 'next/link';

interface ChipData {
  icon: string;
  title: string;
  signal: string;
  href: string;
}

const CHIPS: ChipData[] = [
  { icon: '⚡', title: 'Messages', signal: 'chat.messages()', href: '/docs/angular/langgraph/guides/streaming' },
  { icon: '📡', title: 'Status', signal: 'chat.status()', href: '/docs/angular/langgraph/guides/streaming' },
  { icon: '💾', title: 'Persistence', signal: 'threadId', href: '/docs/angular/langgraph/guides/persistence' },
  { icon: '✋', title: 'Interrupts', signal: 'chat.interrupt()', href: '/docs/angular/langgraph/guides/interrupts' },
  { icon: '⏪', title: 'Time Travel', signal: 'chat.history()', href: '/docs/angular/langgraph/guides/time-travel' },
  { icon: '🔀', title: 'Subagents', signal: 'chat.subagents()', href: '/docs/angular/langgraph/guides/subgraphs' },
  { icon: '🔧', title: 'Tool Calls', signal: 'chat.toolCalls()', href: '/docs/angular/langgraph/guides/streaming' },
  { icon: '🧪', title: 'Testing', signal: 'MockTransport', href: '/docs/angular/langgraph/guides/testing' },
];

export function FeatureChips() {
  return (
    <div className="mdx-chip-row">
      {CHIPS.map((chip) => (
        <Link key={chip.title} href={chip.href} className="mdx-chip-link" data-mdx-chrome="">
          <div data-mdx="feature-chip">
            <div className="mdx-chip-icon">{chip.icon}</div>
            <div className="mdx-chip-title">{chip.title}</div>
            <div className="mdx-chip-signal">{chip.signal}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
