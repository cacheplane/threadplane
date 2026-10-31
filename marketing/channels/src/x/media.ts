import { http } from '../http.ts';
import type { XAuth } from './auth.ts';

const UPLOAD_URL = 'https://api.x.com/2/media/upload';
const METADATA_URL = 'https://api.x.com/2/media/metadata';

interface UploadResponse {
  data: { id: string; media_key: string };
}

export async function uploadMedia(
  auth: XAuth,
  png: Buffer,
  alt: string,
): Promise<string> {
  const form = new FormData();
  form.append('media_category', 'tweet_image');
  form.append('media', new Blob([new Uint8Array(png)], { type: 'image/png' }), 'image.png');

  const response = await http<UploadResponse>({
    method: 'POST',
    url: UPLOAD_URL,
    headers: () => ({ Authorization: `Bearer ${auth.accessToken}` }),
    body: form,
    // Upload creates a media resource; like every create it is not retried.
    retryOn5xx: false,
    signal: auth.signal,
    on401: async () => {
      await auth.refresh();
      return { retry: true };
    },
  });

  const mediaId = response.data.id;

  await http({
    method: 'POST',
    url: METADATA_URL,
    headers: () => ({
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'application/json',
    }),
    body: JSON.stringify({ id: mediaId, metadata: { alt_text: { text: alt } } }),
    // Setting alt text on an existing media id is idempotent, so it may retry.
    signal: auth.signal,
    on401: async () => {
      await auth.refresh();
      return { retry: true };
    },
  });

  return mediaId;
}
