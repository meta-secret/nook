/** Canonical production host for nokey.sh (override with VITE_SITE_URL at build time). */
export const DEFAULT_SITE_URL = "https://nokey.sh";

const SitemapChangeFrequency = {
  Weekly: "weekly",
  Monthly: "monthly",
} as const;

type SitemapChangeFrequency =
  (typeof SitemapChangeFrequency)[keyof typeof SitemapChangeFrequency];

export type SitemapEntry = {
  path: string;
  changefreq: SitemapChangeFrequency;
  priority: string;
};

/** Public routes suitable for search indexing (keep in sync with LEGAL_PAGES paths). */
export const PUBLIC_SITEMAP_ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: SitemapChangeFrequency.Weekly, priority: "1.0" },
  {
    path: "/privacy.html",
    changefreq: SitemapChangeFrequency.Monthly,
    priority: "0.6",
  },
  {
    path: "/terms.html",
    changefreq: SitemapChangeFrequency.Monthly,
    priority: "0.6",
  },
];

export class DefaultSiteUrlEnvironment {
  readonly siteUrl = DEFAULT_SITE_URL;
}

export class ConfiguredSiteUrlEnvironment {
  readonly siteUrl: string;

  constructor(siteUrl: string) {
    this.siteUrl = siteUrl;
  }
}

export type SiteUrlEnvironment =
  DefaultSiteUrlEnvironment | ConfiguredSiteUrlEnvironment;

export class SiteUrlConfiguration {
  constructor(private readonly request: SiteUrlEnvironment) {}
  get url(): string {
    const environment = this.request;

    const trimmed = environment.siteUrl.trim();
    if (trimmed) {
      return trimmed.replace(/\/$/, "");
    }
    return DEFAULT_SITE_URL;
  }
}

type AbsoluteSiteUrlRequest = {
  readonly siteUrl: string;
  readonly path: string;
};

export class PublicSiteLocation {
  constructor(private readonly request: AbsoluteSiteUrlRequest) {}
  get url(): string {
    const { siteUrl, path } = this.request;

    const base = siteUrl.replace(/\/$/, "");
    if (path === "/") {
      return `${base}/`;
    }
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
  }
}

type SitemapXmlDocument = {
  readonly siteUrl: string;
  readonly lastmod: Date;
};

export class SitemapDocument {
  private static escapeXml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  constructor(private readonly request: SitemapXmlDocument) {}
  get xml(): string {
    const { siteUrl, lastmod } = this.request;

    const isoDate = lastmod.toISOString().slice(0, 10);
    const body = PUBLIC_SITEMAP_ENTRIES.map(
      (entry) => `  <url>
    <loc>${SitemapDocument.escapeXml(
      (() => {
        const absoluteSiteUrlArgs: ConstructorParameters<
          typeof PublicSiteLocation
        >[0] = {
          siteUrl,
          path: entry.path,
        };
        return new PublicSiteLocation(absoluteSiteUrlArgs).url;
      })(),
    )}</loc>
    <lastmod>${isoDate}</lastmod>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`,
    ).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${body}
</urlset>
`;
  }
}

export class RobotsDocument {
  constructor(private readonly request: string) {}
  get text(): string {
    const siteUrl = this.request;

    const base = siteUrl.replace(/\/$/, "");
    return `User-agent: *
Allow: /$
Allow: /about.html
Allow: /privacy.html
Allow: /terms.html
Allow: /assets/
Allow: /favicon.png
Allow: /nook-logo-dark.png
Allow: /nook-logo-light.png
Allow: /nook-logo-dark-transparent.png
Allow: /robots.txt
Allow: /sitemap.xml
Disallow: /app/
Disallow: /app-logs
Disallow: /admin
Disallow: /devices-access
Disallow: /extension-connect
Disallow: /help
Disallow: /logs
Disallow: /onboard
Disallow: /privacy
Disallow: /settings
Disallow: /terms
Disallow: /vault

Sitemap: ${base}/sitemap.xml
`;
  }
}
