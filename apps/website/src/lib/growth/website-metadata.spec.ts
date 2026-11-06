import {
  acquisitionProperties,
  installedPackages,
  contentForPath,
} from './website-metadata';

describe('website metadata minimization', () => {
  it('keeps campaign tokens and referrer host, excluding arbitrary URLs and query text', () => {
    expect(
      acquisitionProperties(
        '?utm_source= Newsletter &utm_medium=email&utm_campaign=autumn-2026&search=private',
        'https://example.org/articles?secret=x#fragment'
      )
    ).toEqual({
      campaignSource: 'newsletter',
      campaignMedium: 'email',
      campaignName: 'autumn-2026',
      referrerHost: 'example.org',
    });
    expect(
      acquisitionProperties(
        '?utm_source=reader%40example.org&utm_medium=https%3A%2F%2Fprivate.org&token=secret',
        'javascript:private'
      )
    ).toEqual({});
  });
  it('emits only catalogued content IDs and ignores arbitrary paths', () => {
    const catalog = {
      '/docs/angular/chat/quickstart': {
        contentId: 'chat-quickstart',
        topic: 'getting_started' as const,
      },
    };
    expect(contentForPath('/docs/angular/chat/quickstart', catalog)).toEqual(
      catalog['/docs/angular/chat/quickstart']
    );
    expect(contentForPath('/private/user@example.invalid', catalog)).toBeNull();
    expect(
      contentForPath('/docs/angular/chat/quickstart?secret=x', catalog)
    ).toBeNull();
    expect(contentForPath('/docs/angular/chat/quickstart#private', catalog)).toBeNull();
  });
  it('recognizes install commands without returning copied code or arbitrary package text', () => {
    expect(
      installedPackages(
        'npm install @threadplane/chat @threadplane/langgraph@latest rxjs'
      )
    ).toEqual(['@threadplane/chat', '@threadplane/langgraph']);
    expect(installedPackages('pnpm add @threadplane/render')).toEqual([
      '@threadplane/render',
    ]);
    expect(
      installedPackages('import { chat } from "@threadplane/chat";')
    ).toEqual([]);
    expect(installedPackages('echo npm install @threadplane/chat')).toEqual([]);
    expect(installedPackages('npm install @threadplane/chat-fake')).toEqual([]);
  });
});
