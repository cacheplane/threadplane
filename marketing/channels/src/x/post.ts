import { http } from '../http.ts';
import { writeDryRunResult } from '../dry-run.ts';
import type { Draft, PostResult } from '../types.ts';
import type { XAuth } from './auth.ts';
import { uploadMedia } from './media.ts';

const TWEETS_URL = 'https://api.x.com/2/tweets';

interface TweetResponse {
  data: { id: string; text: string };
}

interface TweetRequestBody {
  text: string;
  media?: { media_ids: string[] };
  reply?: { in_reply_to_tweet_id: string };
}

async function postTweet(auth: XAuth, body: TweetRequestBody): Promise<string> {
  const response = await http<TweetResponse>({
    method: 'POST',
    url: TWEETS_URL,
    // Read per attempt so the retry after a refresh sends the new token.
    headers: () => ({
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify(body),
    // A create is never retried: a 5xx or timeout may still have posted.
    retryOn5xx: false,
    signal: auth.signal,
    on401: async () => {
      await auth.refresh();
      return { retry: true };
    },
  });
  return response.data.id;
}

export async function postX(auth: XAuth, draft: Draft): Promise<PostResult> {
  if (process.env.DRY_RUN === '1') {
    return writeDryRunResult(draft);
  }

  const mediaIds: string[] = [];
  if (draft.media && draft.media.length > 0) {
    for (const m of draft.media) {
      mediaIds.push(await uploadMedia(auth, m.png, m.alt));
    }
  }

  let firstId: string;

  if (draft.threadParts) {
    const firstBody: TweetRequestBody = { text: draft.threadParts[0] };
    if (mediaIds.length > 0) firstBody.media = { media_ids: mediaIds };
    firstId = await postTweet(auth, firstBody);

    let prevId = firstId;
    for (let i = 1; i < draft.threadParts.length; i++) {
      prevId = await postTweet(auth, {
        text: draft.threadParts[i],
        reply: { in_reply_to_tweet_id: prevId },
      });
    }
  } else {
    const body: TweetRequestBody = { text: draft.text! };
    if (mediaIds.length > 0) body.media = { media_ids: mediaIds };
    firstId = await postTweet(auth, body);
  }

  return {
    channel: 'x',
    postId: firstId,
    url: `https://x.com/${auth.userHandle}/status/${firstId}`,
    postedAt: new Date().toISOString(),
  };
}
