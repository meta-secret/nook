import { defineConfig, type Plugin } from 'vitest/config'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const viteBase =
  typeof Bun !== 'undefined' ? Bun.env.VITE_BASE : process.env.VITE_BASE

/** GitHub Pages (and similar) need 404.html = index.html for client-side routes. */
function spaFallback(): Plugin {
  return {
    name: 'spa-fallback',
    closeBundle() {
      const outDir = join(__dirname, 'dist')
      copyFileSync(join(outDir, 'index.html'), join(outDir, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  base: viteBase ?? '/',
  plugins: [tailwindcss(), svelte(), spaFallback()],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
    },
  },
  server: {
    fs: {
      allow: ['..'],
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**'],
    environment: 'happy-dom',
  },
})
