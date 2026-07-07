import { defineConfig, type Plugin } from 'vitest/config'
import { copyFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import {
  buildRobotsTxt,
  buildSitemapXml,
  siteUrlFromEnv,
} from './src/lib/sitemap'

const viteBase =
  typeof Bun !== 'undefined' ? Bun.env.VITE_BASE : process.env.VITE_BASE

/** GitHub Pages (and similar) need 404.html = index.html for client-side routes. */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    writeBundle() {
      const outDir = join(process.cwd(), 'dist')
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'))
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
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
    },
  },
  server: {
    fs: {
      allow: ['../..'],
    },
  },
  test: {
    include: ['tests/unit/**/*.{test,spec}.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'happy-dom',
    setupFiles: ['tests/unit/setup-wasm.ts'],
  },
})
