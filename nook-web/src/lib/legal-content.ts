import privacyPolicyMd from '../../../docs/privacy-policy.md?raw'
import termsOfServiceMd from '../../../docs/terms-of-service.md?raw'

export type LegalPageId = 'privacy' | 'terms'

export type LegalPage = {
  id: LegalPageId
  title: string
  path: string
  source: string
}

export const LEGAL_PAGES: Record<LegalPageId, LegalPage> = {
  privacy: {
    id: 'privacy',
    title: 'Privacy Policy',
    path: '/privacy',
    source: privacyPolicyMd,
  },
  terms: {
    id: 'terms',
    title: 'Terms of Service',
    path: '/terms',
    source: termsOfServiceMd,
  },
}

const LEGAL_PATHS = new Map(
  Object.values(LEGAL_PAGES).map((page) => [page.path, page.id] as const),
)

/** Build an app URL that respects Vite `BASE_URL` (e.g. GitHub Pages subpaths). */
export function appPath(path: string): string {
  const base = import.meta.env.BASE_URL
  const normalized = path.startsWith('/') ? path.slice(1) : path
  return `${base}${normalized}`
}

function stripBasePath(pathname: string): string {
  const base = import.meta.env.BASE_URL
  if (base !== '/' && pathname.startsWith(base)) {
    const rest = pathname.slice(base.length)
    return rest ? `/${rest.replace(/^\//, '')}` : '/'
  }
  return pathname
}

/** Resolve `/privacy` or `/terms` from the current location pathname. */
export function getLegalPageFromPath(pathname: string): LegalPageId | null {
  const normalized = stripBasePath(pathname).replace(/\/$/, '') || '/'
  return LEGAL_PATHS.get(normalized) ?? null
}

export function legalPageForId(id: LegalPageId): LegalPage {
  return LEGAL_PAGES[id]
}
