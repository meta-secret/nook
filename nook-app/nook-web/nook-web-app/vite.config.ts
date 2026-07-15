import { defineConfig, type Plugin } from 'vitest/config'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnv, type PreviewServer, type ViteDevServer } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import {
  buildRobotsTxt,
  buildSitemapXml,
  siteUrlFromEnv,
} from '../nook-web-shared/src/vault-app/lib/sitemap'

const viteBase =
  typeof Bun !== 'undefined' ? Bun.env.VITE_BASE : process.env.VITE_BASE

const COMMON_APP_SPA_PATHS = new Set([
  '/app-logs',
  '/logs',
  '/privacy',
  '/terms',
])
const NOT_FOUND_PATHS = new Set(['/schema.xml'])
const APP_SHELL_ALIASES = ['app-logs', 'extension-connect', 'logs']
const STATIC_NOT_FOUND_DOCUMENT = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="robots" content="noindex" />
    <title>404</title>
  </head>
  <body>
    <main><h1>404</h1></main>
  </body>
</html>
`

function routeSpaRequestsToApp(
  server: ViteDevServer | PreviewServer,
  appKind: string,
): void {
  server.middlewares.use((request, response, next) => {
    const requestUrl = request.url
    if (!requestUrl) {
      next()
      return
    }

    const suffixIndex = requestUrl.search(/[?#]/)
    const pathname =
      suffixIndex === -1 ? requestUrl : requestUrl.slice(0, suffixIndex)
    const suffix = suffixIndex === -1 ? '' : requestUrl.slice(suffixIndex)
    const normalizedPath = pathname.replace(/\/$/, '') || '/'

    if (
      NOT_FOUND_PATHS.has(normalizedPath) ||
      normalizedPath === '/site/schema.xml'
    ) {
      response.statusCode = 404
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end('Not Found')
      return
    }

    const appSpaPaths =
      appKind === 'unified-development'
        ? new Set([...COMMON_APP_SPA_PATHS, '/extension-connect'])
        : new Set<string>()
    if (appSpaPaths.has(normalizedPath)) {
      request.url = `/app/index.html${suffix}`
    }
    next()
  })
}

/** Keep the public landing alias and route SPA fallbacks into the vault app. */
function spaFallback(appKind: string, outputDirectory: string): Plugin {
  return {
    name: 'spa-fallback',
    configureServer(server) {
      routeSpaRequestsToApp(server, appKind)
    },
    configurePreviewServer(server) {
      routeSpaRequestsToApp(server, appKind)
    },
    writeBundle() {
      const outDir = join(process.cwd(), outputDirectory)
      if (appKind === 'site') {
        copyFileSync(join(outDir, 'index.html'), join(outDir, 'about.html'))
        writeFileSync(join(outDir, '404.html'), STATIC_NOT_FOUND_DOCUMENT)
        return
      }
      const appShell = join(outDir, 'app/index.html')
      copyFileSync(appShell, join(outDir, 'index.html'))
      copyFileSync(appShell, join(outDir, '404.html'))
      for (const alias of APP_SHELL_ALIASES) {
        if (
          alias !== 'extension-connect' ||
          appKind === 'unified-development'
        ) {
          copyFileSync(appShell, join(outDir, `${alias}.html`))
        }
      }
    },
  }
}

/** Emit sitemap.xml and robots.txt for production deploys (nokey.sh). */
function seoStaticFiles(outputDirectory: string): Plugin {
  const serveDevelopmentSeoFiles = (server: ViteDevServer): void => {
    server.middlewares.use((request, response, next) => {
      const pathname = request.url?.split(/[?#]/, 1)[0]
      const siteUrl = siteUrlFromEnv(process.env)
      const body =
        pathname === '/robots.txt'
          ? buildRobotsTxt(siteUrl)
          : pathname === '/sitemap.xml'
            ? buildSitemapXml(siteUrl)
            : undefined
      if (body === undefined) {
        next()
        return
      }

      response.statusCode = 200
      response.setHeader(
        'Content-Type',
        pathname === '/robots.txt'
          ? 'text/plain; charset=utf-8'
          : 'application/xml; charset=utf-8',
      )
      response.end(body)
    })
  }

  return {
    name: 'seo-static-files',
    configureServer(server) {
      serveDevelopmentSeoFiles(server)
    },
    writeBundle() {
      const outDir = join(process.cwd(), outputDirectory)
      const siteUrl = siteUrlFromEnv(process.env)
      writeFileSync(join(outDir, 'sitemap.xml'), buildSitemapXml(siteUrl))
      writeFileSync(join(outDir, 'robots.txt'), buildRobotsTxt(siteUrl))
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const appKind =
    env.VITE_NOOK_APP_KIND === 'site' ? 'site' : 'unified-development'
  const outputDirectory = env.VITE_NOOK_OUT_DIR ?? 'dist'
  const input: Record<string, string> =
    appKind === 'site'
      ? {
          landing: join(process.cwd(), 'index.html'),
        }
      : {
          landing: join(process.cwd(), 'index.html'),
          app: join(process.cwd(), 'app/index.html'),
        }

  return {
    base: viteBase ?? '/',
    define: {
      __NOOK_APP_KIND__: JSON.stringify(appKind),
      __NOOK_WASM_APPLICATION__: JSON.stringify('unified-development'),
    },
    plugins: [
      tailwindcss(),
      svelte(),
      spaFallback(appKind, outputDirectory),
      seoStaticFiles(outputDirectory),
    ],
    build: {
      outDir: outputDirectory,
      emptyOutDir: true,
      rollupOptions: {
        input,
      },
    },
    resolve: {
      alias: {
        $lib: new URL('../nook-web-shared/src/vault-app/lib', import.meta.url)
          .pathname,
        '$vault-shared': new URL(
          '../nook-web-shared/src/vault-app',
          import.meta.url,
        ).pathname,
        '$web-shared': new URL('../nook-web-shared/src', import.meta.url)
          .pathname,
        '$app-wasm': new URL(
          '../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm',
          import.meta.url,
        ).pathname,
      },
    },
    server: {
      fs: {
        allow: ['../../..'],
      },
    },
    test: {
      include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
      exclude: ['e2e/**', 'node_modules/**'],
      environment: 'happy-dom',
      setupFiles: ['tests/unit/setup-wasm.ts'],
    },
  }
})
