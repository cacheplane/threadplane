import { http } from '../http.ts';
import type { LinkedInAuth } from './auth.ts';
import { linkedInPost } from './api.ts';

interface InitializeUploadResponse {
  value: { uploadUrl: string; image: string; uploadUrlExpiresAt: number };
}

/** Uploads a PNG owned by the author and returns its urn:li:image URN. */
export async function uploadImage(auth: LinkedInAuth, png: Buffer): Promise<string> {
  const { data } = await linkedInPost<InitializeUploadResponse>(
    auth,
    '/images?action=initializeUpload',
    { initializeUploadRequest: { owner: auth.authorUrn } },
  );

  await http({
    method: 'PUT',
    url: data.value.uploadUrl,
    headers: {
      Authorization: `Bearer ${auth.accessToken}`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(png),
  });

  return data.value.image;
}
