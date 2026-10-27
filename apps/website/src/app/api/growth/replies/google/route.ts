/** Historical Google callbacks are retired; receiving is owned by Resend. */
export async function POST(_request: Request): Promise<Response> {
  void _request;
  return new Response('Google mailbox integration retired', {
    status: 410,
    headers: {
      'Cache-Control': 'no-store',
      'Content-Type': 'text/plain; charset=utf-8',
    },
  });
}
