import { http } from '../http.ts';
import type { PostMetrics } from '../types.ts';

interface DevToArticleDetail {
  id: number;
  page_views_count?: number;
  comments_count?: number;
  public_reactions_count?: number;
}

export async function fetchDevToMetrics(
  apiKey: string,
  postId: string,
): Promise<PostMetrics> {
  let response: DevToArticleDetail;
  try {
    response = await http<DevToArticleDetail>({
      method: 'GET',
      url: `https://dev.to/api/articles/${postId}`,
      headers: {
        'api-key': apiKey,
        'User-Agent': 'threadplane-marketing/1.0',
      },
    });
  } catch (err) {
    const message = (err as Error).message;
    if (message.startsWith('HTTP 404')) {
      throw new Error(`Dev.to article ${postId} not found.`);
    }
    throw err;
  }

  return {
    postId,
    impressions: response.page_views_count ?? 0,
    replies: response.comments_count ?? 0,
    shares: response.public_reactions_count ?? 0,
    clicks: undefined,
    fetchedAt: new Date().toISOString(),
  };
}
