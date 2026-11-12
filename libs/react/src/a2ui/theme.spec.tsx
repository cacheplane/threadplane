import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import { A2uiSurface } from './index';
import { a2uiSurfaceTheme } from './surface-theme';

afterEach(cleanup);

const surface = (theme?: unknown): A2uiSurfaceSnapshot =>
  ({
    surfaceId: 's',
    catalogId: 'basic',
    ...(theme === undefined ? {} : { theme }),
    components: [{ id: 'root', component: 'Text', text: 'Body' }],
    dataModel: {},
  } as A2uiSurfaceSnapshot);
const root = (theme?: unknown) => {
  const view = render(<A2uiSurface surface={surface(theme)} />);
  return { view, node: view.container.querySelector('.a2ui-surface') as HTMLElement };
};

describe('A2UI surface theme', () => {
  it('adds no style and no chrome without a theme', () => {
    for (const theme of [undefined, {}, null, 'red', { primaryColor: '', agentDisplayName: '  ', iconUrl: '' }]) {
      const { node } = root(theme);
      expect(node.hasAttribute('style'), JSON.stringify(theme)).toBe(false);
      expect(node.querySelector('.a2ui-surface-chrome')).toBeNull();
      expect(node.textContent).toBe('Body');
      cleanup();
    }
  });

  it('sets the accent from a hex primary colour, with readable text on it', () => {
    const dark = root({ primaryColor: '#0B6B3A' }).node;
    expect(dark.style.getPropertyValue('--a2ui-primary')).toBe('#0B6B3A');
    expect(dark.style.getPropertyValue('--a2ui-on-primary')).toBe('#ffffff');
    expect(dark.style.getPropertyValue('--a2ui-primary-hover')).toBe('color-mix(in srgb, #0B6B3A 85%, #ffffff)');
    cleanup();
    const light = root({ primaryColor: ' #fd0 ' }).node;
    expect(light.style.getPropertyValue('--a2ui-primary')).toBe('#fd0');
    expect(light.style.getPropertyValue('--a2ui-on-primary')).toBe('#111111');
    expect(a2uiSurfaceTheme(surface({ primaryColor: '#00000080' })).style).toMatchObject({ '--a2ui-on-primary': '#ffffff' });
    expect(a2uiSurfaceTheme(surface({ primaryColor: '#ffff' })).style).toMatchObject({ '--a2ui-on-primary': '#111111' });
  });

  it('ignores a primary colour that is not a hex colour', () => {
    for (const primaryColor of ['red', 'rgb(1, 2, 3)', '#12', '#12345', '#gggggg', 'red; background: url(https://example.test/x)', '#fff;color:red', 'var(--x)', 7, { path: '/x' }]) {
      expect(a2uiSurfaceTheme(surface({ primaryColor })).style, String(primaryColor)).toBeUndefined();
    }
    const html = renderToString(<A2uiSurface surface={surface({ primaryColor: '#fff;background:url(https://example.test/x)' })} />);
    expect(html).not.toContain('style=');
    expect(html).not.toContain('example.test');
  });

  it('shows the agent name and icon above the content, literally', () => {
    const { node } = root({ agentDisplayName: ' <b>Rail</b> desk ', iconUrl: 'https://example.test/icon.png' });
    const chrome = node.querySelector('.a2ui-surface-chrome') as HTMLElement;
    expect(node.firstElementChild).toBe(chrome);
    expect(chrome.textContent).toBe('<b>Rail</b> desk');
    expect(chrome.querySelector('b')).toBeNull();
    const icon = chrome.querySelector('img') as HTMLImageElement;
    expect(icon.getAttribute('src')).toBe('https://example.test/icon.png');
    expect(icon.getAttribute('alt')).toBe('');
    expect(icon.getAttribute('referrerpolicy')).toBe('no-referrer');
  });

  it('shows either part alone, and drops an icon address the catalog would not load', () => {
    const named = root({ agentDisplayName: 'Rail desk', iconUrl: 'javascript:alert(1)' }).node;
    expect(named.querySelector('img')).toBeNull();
    expect(named.querySelector('.a2ui-surface-chrome')?.textContent).toBe('Rail desk');
    cleanup();
    const icon = root({ iconUrl: 'data:image/png;base64,AAAA' }).node;
    expect(icon.querySelector('img')).not.toBeNull();
    expect(icon.querySelector('.a2ui-surface-chrome__name')).toBeNull();
    cleanup();
    expect(root({ iconUrl: 'data:text/html,<p>x</p>' }).node.querySelector('.a2ui-surface-chrome')).toBeNull();
  });

  it('follows a new snapshot and keeps the caller class', () => {
    const view = render(<A2uiSurface surface={surface({ primaryColor: '#0b6b3a', agentDisplayName: 'One' })} className="mine" />);
    const node = view.container.querySelector('.a2ui-surface') as HTMLElement;
    expect(node.className).toBe('a2ui-surface mine');
    view.rerender(<A2uiSurface surface={surface({ agentDisplayName: 'Two' })} className="mine" />);
    expect(node.style.getPropertyValue('--a2ui-primary')).toBe('');
    expect(node.querySelector('.a2ui-surface-chrome')?.textContent).toBe('Two');
    view.rerender(<A2uiSurface surface={surface()} className="mine" />);
    expect(node.querySelector('.a2ui-surface-chrome')).toBeNull();
  });
});
