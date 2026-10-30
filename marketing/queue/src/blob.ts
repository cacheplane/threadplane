// Minimal Vercel Blob client: no @vercel/blob dependency, `fetch` injected so
// specs never touch the network.
const BLOB_API = 'https://blob.vercel-storage.com';

export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: Buffer }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export async function uploadMedia(
  bytes: Buffer,
  pathname: string,
  token: string,
  fetchImpl: FetchLike = fetch as unknown as FetchLike
): Promise<string> {
  const response = await fetchImpl(`${BLOB_API}/${pathname}`, {
    method: 'PUT',
    headers: {
      authorization: `Bearer ${token}`,
      'x-content-type': 'image/png',
      'x-add-random-suffix': '0',
      'x-api-version': '7',
    },
    body: bytes,
  });
  if (!response.ok) {
    throw new Error(`Blob upload of ${pathname} failed: HTTP ${response.status}`);
  }
  const url = ((await response.json()) as { url?: unknown }).url;
  if (typeof url !== 'string' || !url) {
    throw new Error(`Blob upload of ${pathname} returned no url`);
  }
  return url;
}
