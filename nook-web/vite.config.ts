import { defineConfig } from 'vitest/config'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

const viteBase =
  typeof Bun !== 'undefined' ? Bun.env.VITE_BASE : process.env.VITE_BASE

// https://vite.dev/config/
export default defineConfig({
  base: viteBase ?? '/',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
    },
  },
  test: {
    include: ['src/**/*.{test,spec}.{js,ts}'],
    exclude: ['e2e/**', 'node_modules/**'],
  },
})
