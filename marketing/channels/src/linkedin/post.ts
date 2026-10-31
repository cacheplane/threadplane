import { writeDryRunResult } from '../dry-run.ts';
import type { Draft, PostResult } from '../types.ts';
import type { LinkedInAuth } from './auth.ts';
import { linkedInPost } from './api.ts';
import { escapeLittleText } from './little.ts';
import { uploadImage } from './media.ts';

interface PostRequestBody {
  author: string;
  commentary: string;
  visibility: 'PUBLIC';
  distribution: {
    feedDistribution: 'MAIN_FEED';
    targetEntities: [];
    thirdPartyDistributionChannels: [];
  };
  content?: { media: { id: string; altText: string } };
  lifecycleState: 'PUBLISHED';
  isReshareDisabledByAuthor: false;
}

async function createPost(auth: LinkedInAuth, body: PostRequestBody): Promise<string> {
  const { restliId } = await linkedInPost(auth, '/posts', body);
  if (!restliId) {
    throw new Error('LinkedIn created the post but returned no x-restli-id header.');
  }
  return restliId;
}

async function createComment(auth: LinkedInAuth, postUrn: string, text: string): Promise<void> {
  await linkedInPost(auth, `/socialActions/${encodeURIComponent(postUrn)}/comments`, {
    actor: auth.authorUrn,
    object: postUrn,
    message: { text },
  });
}

export async function postLinkedIn(auth: LinkedInAuth, draft: Draft): Promise<PostResult> {
  if (process.env.DRY_RUN === '1') {
    return writeDryRunResult(draft);
  }
  auth.assertUsable();

  const body: PostRequestBody = {
    author: auth.authorUrn,
    commentary: escapeLittleText(draft.text!),
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
    isReshareDisabledByAuthor: false,
  };

  const image = draft.media?.[0];
  if (image) {
    body.content = { media: { id: await uploadImage(auth, image.png), altText: image.alt } };
  }

  const postUrn = await createPost(auth, body);
  const result: PostResult = {
    channel: 'linkedin',
    postId: postUrn,
    url: `https://www.linkedin.com/feed/update/${postUrn}/`,
    postedAt: new Date().toISOString(),
  };

  // The post is already live, so a failed comment must not throw and hide it.
  if (draft.firstComment) {
    try {
      await createComment(auth, postUrn, draft.firstComment);
    } catch (err) {
      result.warnings = [
        `Post is live but the first comment failed; add it by hand. ${(err as Error).message}`,
      ];
    }
  }

  return result;
}
