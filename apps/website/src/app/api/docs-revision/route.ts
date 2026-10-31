/** Statically compiled source identity of this website artifact. */
export const dynamic = 'force-static';

export function GET() {
  // next.config injects this at build time; a runtime environment cannot relabel
  // an older artifact as the expected deployment.
  return Response.json(
    { revision: process.env['THREADPLANE_DOCS_BUILD_REVISION'] },
    { headers: { 'Cache-Control': 'no-store' } }
  );
}
