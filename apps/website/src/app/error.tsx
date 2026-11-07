'use client';

import { useEffect } from 'react';
import { Container } from '../components/ui/Container';
import { Section } from '../components/ui/Section';
import { Button } from '../components/ui/Button';

interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/**
 * App-router error boundary. Next.js renders this when a server or
 * client component throws an uncaught error within this route segment.
 * `reset` re-mounts the segment without a full reload.
 */
export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  useEffect(() => {
    // Surface errors to whatever observability the app already wires up.
    // Logging via console.error so it lands in browser devtools and any
    // existing PostHog console-bridge or similar.
    console.error('Unhandled error in app router:', error);
  }, [error]);

  return (
    <Section
      surface="white"
      className="recovery-page"
      ariaLabelledBy="error-heading"
    >
      <Container>
        <div className="error-page-inner">
          <h1 id="error-heading" className="error-page-h1">
            Something went wrong.
          </h1>
          <p className="error-page-body">
            An unexpected error stopped this page from rendering. The team has
            been notified. You can try again, or head back home.
          </p>
          {error.digest ? (
            <p className="error-page-digest">Error ID: {error.digest}</p>
          ) : (
            <div className="error-page-spacer" />
          )}
          <div className="error-page-buttons">
            <Button variant="primary" size="lg" onClick={reset}>
              Try again
            </Button>
            <Button variant="secondary" size="lg" href="/">
              Back home
            </Button>
          </div>
        </div>
      </Container>
    </Section>
  );
}
