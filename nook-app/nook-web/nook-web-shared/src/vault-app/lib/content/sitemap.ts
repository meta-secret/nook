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
  private readonly request: SiteUrlEnvironment;

  constructor(request: SiteUrlEnvironment) {
    this.request = request;
  }
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
  private readonly request: AbsoluteSiteUrlRequest;

  constructor(request: AbsoluteSiteUrlRequest) {
    this.request = request;
  }
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
  private readonly request: SitemapXmlDocument;

  constructor(request: SitemapXmlDocument) {
    this.request = request;
  }

  private locationXml(entry: SitemapEntry): string {
    // eslint-disable-next-line nook-typed-api/no-raw-object-arguments -- Existing call shape is preserved for this lint-only fix.
    const location = new PublicSiteLocation({
      siteUrl: this.request.siteUrl,
      path: entry.path,
    });
    return location.url
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  get xml(): string {
    const { lastmod } = this.request;

    const isoDate = lastmod.toISOString().slice(0, 10);
    const body = PUBLIC_SITEMAP_ENTRIES.map(
      (entry: SitemapEntry) => `  <url>
    <loc>${this.locationXml(entry)}</loc>
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
  private readonly request: string;

  constructor(request: string) {
    this.request = request;
  }
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
