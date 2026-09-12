const LEGACY_APP_ROOTS = [
  '/site',
  '/simple',
  '/sentinel',
  '/app',
  '/app-logs',
  '/logs',
  '/extension-connect',
]
const LEGACY_APP_FILES = new Set([
  '/app-logs.html',
  '/logs.html',
  '/extension-connect.html',
])

/** @param {string} pathname */
function isLegacyAppPath(pathname) {
  return (
    LEGACY_APP_FILES.has(pathname) ||
    LEGACY_APP_ROOTS.some(
      (root) => pathname === root || pathname.startsWith(`${root}/`),
    )
  )
}

/** @typedef {{ ASSETS: { fetch: typeof fetch } }} LegacyRouteBindings */

/** @type {{ fetch(request: Request, env: LegacyRouteBindings): Promise<Response> }} */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url)
    if (isLegacyAppPath(pathname)) {
      return new Response('Not Found\n', {
        status: 404,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/plain; charset=utf-8',
        },
      })
    }

    return env.ASSETS.fetch(request)
  },
}
