import { ApiReferencePage } from '../../../components/docs/api/ApiReferencePage';
import { createPageMetadata } from '../../../lib/site-metadata';

export const metadata = createPageMetadata({
  title: 'API Reference — Threadplane',
  description:
    'Generated API reference for Threadplane Angular, React, and shared TypeScript libraries.',
  pathname: '/docs/api',
});

export default function ApiIndexPage() {
  return <ApiReferencePage />;
}
