import { defineConfig, type Plugin } from 'vitest/config'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PreviewServer, ViteDevServer } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import {
  buildRobotsTxt,
  buildSitemapXml,
  siteUrlFromEnv,
} from './src/lib/sitemap'

const viteBase =
  typeof Bun !== 'undefined' ? Bun.env.VITE_BASE : process.env.VITE_BASE

const APP_SPA_PATHS = new Set([
  '/app-logs',
  '/extension-connect',
  '/logs',
  '/privacy',
  '/terms',
])
const NOT_FOUND_PATHS = new Set(['/schema.xml'])
const APP_SHELL_ALIASES = ['app-logs', 'extension-connect', 'logs']

function routeSpaRequestsToApp(server: ViteDevServer | PreviewServer): void {
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

    if (NOT_FOUND_PATHS.has(normalizedPath)) {
      response.statusCode = 404
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end('Not Found')
      return
    }

    if (APP_SPA_PATHS.has(normalizedPath)) {
      request.url = `/app/index.html${suffix}`
    }
    next()
  })
}

/** Keep the public landing alias and route SPA fallbacks into the vault app. */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    configureServer: routeSpaRequestsToApp,
    configurePreviewServer: routeSpaRequestsToApp,
    writeBundle() {
      const outDir = join(process.cwd(), 'dist')
      const appShell = join(outDir, 'app/index.html')
      copyFileSync(appShell, join(outDir, '404.html'))
      for (const alias of APP_SHELL_ALIASES) {
        copyFileSync(appShell, join(outDir, `${alias}.html`))
      }
      copyFileSync(join(outDir, 'index.html'), join(outDir, 'about.html'))
    },
  }
}

/** Emit sitemap.xml and robots.txt for production deploys (nokey.sh). */
function seoStaticFiles(): Plugin {
  return {
    name: 'seo-static-files',
    writeBundle() {
      const outDir = join(process.cwd(), 'dist')
      const siteUrl = siteUrlFromEnv(process.env)
      writeFileSync(join(outDir, 'sitemap.xml'), buildSitemapXml(siteUrl))
      writeFileSync(join(outDir, 'robots.txt'), buildRobotsTxt(siteUrl))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: viteBase ?? '/',
  plugins: [tailwindcss(), svelte(), spaFallback(), seoStaticFiles()],
  build: {
    rollupOptions: {
      input: {
        landing: join(process.cwd(), 'index.html'),
        app: join(process.cwd(), 'app/index.html'),
      },
    },
  },
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
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
})
