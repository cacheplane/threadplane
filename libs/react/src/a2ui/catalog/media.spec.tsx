import { renderToString } from 'react-dom/server';
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { A2uiSurfaceSnapshot } from '@threadplane/content/a2ui';
import { A2uiSurface, a2uiBasicCatalog } from '../index';
import { mediaUrl } from './media-url';

afterEach(cleanup);

type Component = A2uiSurfaceSnapshot['components'][number];
const surface = (
  components: readonly Component[],
  dataModel: A2uiSurfaceSnapshot['dataModel'] = {}
): A2uiSurfaceSnapshot => ({
  surfaceId: 's1',
  catalogId: 'basic',
  components,
  dataModel,
});
const one = (component: Record<string, unknown>, dataModel = {}) =>
  render(
    <A2uiSurface
      surface={surface(
        [{ id: 'root', ...component } as unknown as Component],
        dataModel
      )}
    />
  ).container.firstElementChild as HTMLElement;

describe('A2UI display catalog', () => {
  it('lists the display and disclosure components and no input control', () => {
    expect(Object.keys(a2uiBasicCatalog()).sort()).toEqual([
      'AudioPlayer',
      'Card',
      'Column',
      'Divider',
      'Icon',
      'Image',
      'List',
      'Modal',
      'Row',
      'Tabs',
      'Text',
      'Video',
    ]);
  });

  it('renders an image with its description, preset and fit', () => {
    const root = one({
      component: 'Image',
      url: 'https://example.test/lyon.png',
      description: 'Lyon <b>skyline</b>',
      fit: 'scaleDown',
      variant: 'avatar',
    });
    const img = root.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('https://example.test/lyon.png');
    expect(img.getAttribute('alt')).toBe('Lyon <b>skyline</b>');
    expect(img.className).toBe('a2ui-img a2ui-img--avatar');
    expect(img.style.objectFit).toBe('scale-down');
  });

  it('falls back to the default preset, fit and empty alternative text', () => {
    const img = one({
      component: 'Image',
      url: 'a.png',
      fit: 'constructor',
      variant: 'huge',
      description: 4,
    }).querySelector('img') as HTMLImageElement;
    expect(img.className).toBe('a2ui-img a2ui-img--mediumFeature');
    expect(img.style.objectFit).toBe('fill');
    expect(img.getAttribute('alt')).toBe('');
  });

  it('reads an image URL from the data model and renders nothing without one', () => {
    const bound = one(
      { component: 'Image', url: { path: '/photo' } },
      { photo: 'bound.png' }
    );
    expect(bound.querySelector('img')?.getAttribute('src')).toBe('bound.png');
    cleanup();
    for (const url of ['', 7, null])
      expect(one({ component: 'Image', url }).querySelector('img')).toBeNull();
    expect(one({ component: 'Image' }).querySelector('img')).toBeNull();
  });

  it('loads only relative, http, blob and same-kind data URLs', () => {
    for (const url of ['a.png', '/a.png', '../a.png', '?x=1', 'https://e.test/a', 'HTTP://e.test/a', 'blob:https://e.test/1', 'data:image/png;base64,AA', 'DATA:IMAGE/svg+xml,x'])
      expect(mediaUrl(url, 'image')).toBe(url);
    expect(mediaUrl('  a.png ', 'image')).toBe('a.png');
    for (const url of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'vbscript:x', 'file:///etc/passwd', 'data:text/html,<b>', 'data:video/mp4,x', 'data:imagex/png,x', '', '   ', 4, null, {}])
      expect(mediaUrl(url, 'image')).toBeUndefined();
    expect(mediaUrl('data:video/mp4,x', 'video')).toBe('data:video/mp4,x');
    expect(mediaUrl('data:audio/mp3,x', 'audio')).toBe('data:audio/mp3,x');
    expect(mediaUrl('data:image/png,x', 'audio')).toBeUndefined();
  });

  it('renders no element for a media URL with a script scheme', () => {
    for (const component of ['Image', 'Video', 'AudioPlayer'])
      expect(
        one({ component, url: 'javascript:alert(1)', description: 'x' })
          .childElementCount
      ).toBe(0);
  });

  it('draws a named icon as a snake_case ligature labelled by its name', () => {
    const icon = one({ component: 'Icon', name: 'shoppingCart' }).querySelector(
      '.a2ui-icon'
    ) as HTMLElement;
    expect(icon.tagName).toBe('SPAN');
    expect(icon.className).toBe('a2ui-icon material-symbols-outlined');
    expect(icon.getAttribute('role')).toBe('img');
    expect(icon.getAttribute('aria-label')).toBe('shoppingCart');
    expect(icon.textContent).toBe('shopping_cart');
    cleanup();
    expect(
      one({ component: 'Icon', name: 'trending_up' }).textContent
    ).toBe('trending_up');
  });

  it('draws an inline path icon as a decorative shape', () => {
    const svg = one({
      component: 'Icon',
      name: { svgPath: 'M0 0h10v10z' },
    }).querySelector('svg') as SVGElement;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.getAttribute('focusable')).toBe('false');
    expect(svg.getAttribute('class')).toBe('a2ui-icon a2ui-icon--svg');
    expect(svg.querySelector('path')?.getAttribute('d')).toBe('M0 0h10v10z');
  });

  it('renders no icon for a missing or malformed name', () => {
    for (const name of ['', 3, null, [], { svgPath: 5 }, { other: 'x' }])
      expect(one({ component: 'Icon', name }).childElementCount).toBe(0);
    expect(one({ component: 'Icon' }).childElementCount).toBe(0);
  });

  it('lays list children out vertically by default and horizontally on request', () => {
    const items: Component[] = [
      { id: 'a', component: 'Text', text: 'One' },
      { id: 'b', component: 'Text', text: 'Two' },
    ] as unknown as Component[];
    const list = (extra: Record<string, unknown>) =>
      render(
        <A2uiSurface
          surface={surface([
            { id: 'root', component: 'List', children: ['a', 'b'], ...extra } as unknown as Component,
            ...items,
          ])}
        />
      ).container.querySelector('.a2ui-list') as HTMLElement;
    const vertical = list({});
    expect(vertical.className).toBe('a2ui-list a2ui-list--vertical');
    expect(vertical.style.alignItems).toBe('stretch');
    expect(vertical.textContent).toBe('OneTwo');
    cleanup();
    const horizontal = list({ direction: 'horizontal', align: 'end' });
    expect(horizontal.className).toBe('a2ui-list a2ui-list--horizontal');
    expect(horizontal.style.alignItems).toBe('flex-end');
    cleanup();
    expect(list({ direction: 'diagonal', align: 'toString' }).style.alignItems).toBe('stretch');
  });

  it('renders a video with native controls that does not start by itself', () => {
    const video = one({ component: 'Video', url: 'clip.mp4' }).querySelector(
      'video'
    ) as HTMLVideoElement;
    expect(video.getAttribute('src')).toBe('clip.mp4');
    expect(video.controls).toBe(true);
    expect(video.autoplay).toBe(false);
    expect(video.getAttribute('preload')).toBe('metadata');
    cleanup();
    expect(one({ component: 'Video', url: '' }).childElementCount).toBe(0);
  });

  it('renders an audio player named by its literal description', () => {
    const root = one({
      component: 'AudioPlayer',
      url: 'note.mp3',
      description: 'Voice <i>note</i>',
    });
    const audio = root.querySelector('audio') as HTMLAudioElement;
    expect(audio.getAttribute('src')).toBe('note.mp3');
    expect(audio.controls).toBe(true);
    expect(audio.autoplay).toBe(false);
    expect(audio.getAttribute('aria-label')).toBe('Voice <i>note</i>');
    expect(root.querySelector('.a2ui-audio-description')?.textContent).toBe(
      'Voice <i>note</i>'
    );
    expect(root.querySelector('i')).toBeNull();
  });

  it('omits the audio description when there is none and the player without a URL', () => {
    const root = one({ component: 'AudioPlayer', url: 'note.mp3' });
    expect(root.querySelector('.a2ui-audio-description')).toBeNull();
    expect(root.querySelector('audio')?.hasAttribute('aria-label')).toBe(false);
    cleanup();
    expect(one({ component: 'AudioPlayer', description: 'x' }).childElementCount).toBe(0);
  });

  it('server renders media without effects', () => {
    const html = renderToString(
      <A2uiSurface
        surface={surface([
          { id: 'root', component: 'List', children: ['i', 'v'] },
          { id: 'i', component: 'Image', url: 'a.png', description: 'A' },
          { id: 'v', component: 'Icon', name: 'home' },
        ] as unknown as Component[])}
      />
    );
    expect(html).toContain('src="a.png"');
    expect(html).toContain('alt="A"');
    expect(html).toContain('aria-label="home"');
  });
});
