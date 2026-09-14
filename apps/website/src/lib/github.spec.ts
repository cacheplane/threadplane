import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getGitHubStars } from './github';

const fetchMock = vi.hoisted(() => vi.fn());

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

describe('getGitHubStars', () => {
  it('returns the stargazers_count on 2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ stargazers_count: 1234 }),
    });
    const stars = await getGitHubStars('cacheplane/threadplane');
    expect(stars).toBe(1234);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.github.com/repos/cacheplane/threadplane',
      expect.objectContaining({
        next: { revalidate: 86400 },
      }),
    );
  });

  it('returns null on non-2xx', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await getGitHubStars('owner/repo')).toBeNull();
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValue(new Error('network'));
    expect(await getGitHubStars('owner/repo')).toBeNull();
  });

  it('returns null when payload lacks stargazers_count', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });
    expect(await getGitHubStars('owner/repo')).toBeNull();
  });
});
