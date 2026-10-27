import { expect, test } from 'vitest';
import { POST } from './route';

test('the retired Google callback requires no secret or database and returns Gone', async () => {
  const response = await POST(
    new Request('https://threadplane.ai/api/growth/replies/google', {
      method: 'POST',
      body: '{}',
    })
  );
  expect(response.status).toBe(410);
  expect(response.headers.get('cache-control')).toBe('no-store');
});
