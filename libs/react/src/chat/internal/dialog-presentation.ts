import type { CSSProperties } from 'react';

const tokens = [
  '--tp-chat-text',
  '--tp-chat-muted',
  '--tp-chat-border',
  '--tp-chat-surface',
  '--tp-chat-accent',
  '--tp-chat-on-accent',
  '--tp-chat-danger',
  '--tp-chat-gap',
  '--ds-text-primary',
  '--ds-text-secondary',
  '--ds-border',
  '--ds-surface',
  '--ds-accent',
];

export function dialogPresentation(marker: HTMLElement): CSSProperties {
  const win = marker.ownerDocument.defaultView;
  if (!win) return {};
  const chain: CSSStyleDeclaration[] = [];
  for (let node: HTMLElement | null = marker; node; node = node.parentElement)
    chain.push(win.getComputedStyle(node));
  const resolved = (name: string) =>
    chain
      .map((style) => style.getPropertyValue(name))
      .find((value) => value.trim()) ?? '';
  const style: Record<string, string> = {};
  for (const name of tokens) style[name] = resolved(name);
  for (const name of [
    'direction',
    'font-family',
    'font-size',
    'font-weight',
    'line-height',
    'color-scheme',
  ])
    style[name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase())] =
      resolved(name);
  if (!style['direction'])
    style['direction'] = marker.closest('[dir]')?.getAttribute('dir') ?? 'ltr';
  return style;
}

export function availableDialogTarget(
  target: HTMLElement,
  doc: Document
): boolean {
  if (
    target.ownerDocument !== doc ||
    !target.isConnected ||
    target.matches(':disabled') ||
    !target.getClientRects().length
  )
    return false;
  const win = doc.defaultView;
  if (!win) return false;
  for (let node: HTMLElement | null = target; node; node = node.parentElement) {
    const style = win.getComputedStyle(node);
    if (
      node.hidden ||
      node.hasAttribute('inert') ||
      style.display === 'none' ||
      ['hidden', 'collapse'].includes(style.visibility)
    )
      return false;
  }
  return true;
}
