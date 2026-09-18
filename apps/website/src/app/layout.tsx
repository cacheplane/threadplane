import type { Metadata } from 'next';
import { Archivo, Archivo_Black, Inter, JetBrains_Mono } from 'next/font/google';
import '@threadplane/design-tokens/tokens.css';
import './global.css';
import { Nav } from '../components/shared/Nav';
import { SiteFooter } from '../components/shared/SiteFooter';
import { AnnouncementToast } from '../components/shared/AnnouncementToast';
import { WebsiteWorkspaceRoot } from '../components/workspace/WebsiteWorkspace';
import { JsonLd } from '../components/shared/JsonLd';
import { rootJsonLd } from '../lib/structured-data';
import {
  DEFAULT_META_DESCRIPTION,
  DEFAULT_SOCIAL_IMAGE_META,
  LONG_SUBHEAD,
  PRIMARY_TAGLINE,
  SITE_NAME,
  SITE_ORIGIN,
  SITE_X_CREATOR,
  SITE_X_SITE,
} from '../lib/site-metadata';
import { getFormPolicy } from '../lib/growth/form-policy';
import { WebsiteSignals } from '../components/shared/WebsiteSignals';
import { websiteContentCatalog } from '../lib/growth/website-content';

const display = Archivo_Black({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-display',
});

const sans = Archivo({
  subsets: ['latin'],
  // Archivo ships a true italic. Loading it makes every italic on the text
  // face real rather than an obliqued upright — Inter was normal-only here,
  // so those sites had been faux-italic all along.
  style: ['normal', 'italic'],
  variable: '--font-sans',
});

/**
 * Inter is retained for diagrams only, and MUST be loaded here rather than
 * left to theme.css: next/font registers its family under a hashed name, so
 * theme.css's raw `Inter, system-ui` stack never matches it and would silently
 * fall back to system-ui. Diagram geometry is pinned to Inter's metrics —
 * see the FONTS note in src/styles/ui.css and e2e/home-architecture.spec.ts.
 */
const diagram = Inter({
  subsets: ['latin'],
  variable: '--font-diagram',
});

const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE_ORIGIN),
  title: PRIMARY_TAGLINE,
  description: DEFAULT_META_DESCRIPTION,
  openGraph: {
    title: 'Threadplane',
    description: LONG_SUBHEAD,
    type: 'website',
    siteName: SITE_NAME,
    url: '/',
    images: [DEFAULT_SOCIAL_IMAGE_META],
  },
  twitter: {
    card: 'summary_large_image',
    site: SITE_X_SITE,
    creator: SITE_X_CREATOR,
    title: 'Threadplane',
    description: LONG_SUBHEAD,
    images: [DEFAULT_SOCIAL_IMAGE_META],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const formPolicy = getFormPolicy();
  return (
    <html
      lang="en"
      className={`${display.variable} ${sans.variable} ${diagram.variable} ${mono.variable}`}
    >
      <body>
        {/*
          Site-wide structured data, mounted once here so it is present on every
          route. Per-route nodes (BlogPosting, TechArticle) reference the
          Organization by `@id`; those references only resolve because this
          renders alongside them. `rootJsonLd()` is a single `@graph` for that
          reason — do not mount its component builders individually.
        */}
        <JsonLd data={rootJsonLd()} />
        <WebsiteSignals catalog={websiteContentCatalog()} />
        <Nav />
        <div id="site-content">
          <main>
            <WebsiteWorkspaceRoot>{children}</WebsiteWorkspaceRoot>
          </main>
          <SiteFooter formPolicy={formPolicy} />
          <div data-announcement-region="">
            <AnnouncementToast formPolicy={formPolicy} />
          </div>
        </div>
      </body>
    </html>
  );
}
