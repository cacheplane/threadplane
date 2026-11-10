import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MessageActions, type MessageAction } from '@threadplane/react/chat';

function Glyph({ changed = false }: { changed?: boolean }) {
  return <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" focusable="false" data-glyph={changed ? 'changed' : 'initial'}><title>Misleading SVG command</title>{changed ? <circle cx="12" cy="12" r="8" /> : <path d="M4 12h16M12 4v16" />}</svg>;
}
function EmptyIcon() { return null; }

function MessageActionIconsFixture() {
  const [changed, setChanged] = useState(false);
  const [reversed, setReversed] = useState(false);
  const [disabled, setDisabled] = useState(false);
  const [rootDisabled, setRootDisabled] = useState(false);
  const [mounted, setMounted] = useState(true);
  const [rtl, setRtl] = useState(false);
  const [calls, setCalls] = useState<Record<string, number>>({});
  const [argumentCounts, setArgumentCounts] = useState<number[]>([]);
  const record = (id: string) => (...args: unknown[]) => {
    setCalls((previous) => ({ ...previous, [id]: (previous[id] ?? 0) + 1 }));
    setArgumentCounts((previous) => [...previous, args.length]);
  };
  const actions: MessageAction[] = [
    { id: 'text', label: 'Text only', onSelect: record('text') },
    { id: 'labelled', label: 'Icon and label', icon: <Glyph />, onSelect: record('labelled') },
    { id: 'compact', label: changed ? 'Changed <em>& command' : 'Copy <b>& "answer"', icon: <Glyph changed={changed} />, iconOnly: !changed, disabled, onSelect: record(changed ? 'compact-current' : 'compact-initial') },
    ...([undefined, null, false, true] as const).map((icon, index) => ({ id: `absent-${index}`, label: `Absent ${index}`, icon, iconOnly: true, onSelect: record(`absent-${index}`) })),
    { id: 'zero', label: 'Zero icon', icon: 0, iconOnly: true, onSelect: record('zero') },
    ...(['', [], <></>, <EmptyIcon />] as const).map((icon, index) => ({ id: `owned-${index}`, label: `Owned empty ${index}`, icon, iconOnly: true, onSelect: record(`owned-${index}`) })),
  ];
  return <main dir={rtl ? 'rtl' : 'ltr'}>
    <h1>Installed message action icons</h1>
    <nav aria-label="Fixture commands">
      <button onClick={() => setChanged((value) => !value)}>Update action</button>
      <button onClick={() => setReversed((value) => !value)}>Reorder actions</button>
      <button onClick={() => setDisabled((value) => !value)}>Toggle action disabled</button>
      <button onClick={() => setRootDisabled((value) => !value)}>Toggle group disabled</button>
      <button onClick={() => setRtl((value) => !value)}>Toggle direction</button>
      <button onClick={() => setMounted(false)}>Unmount actions</button>
    </nav>
    <output data-testid="icon-counts">{JSON.stringify(calls)}</output>
    <output data-testid="icon-arguments">{JSON.stringify(argumentCounts)}</output>
    <output data-testid="icon-mounted">{mounted ? 'mounted' : 'unmounted'}</output>
    <button type="button">Before actions</button>
    {mounted && <MessageActions actions={reversed ? [...actions].reverse() : actions} label="Icon commands" disabled={rootDisabled} />}
    <button type="button">After actions</button>
  </main>;
}

createRoot(document.getElementById('root')!).render(<MessageActionIconsFixture />);
