import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'

// https://vite.dev/config/
export default defineConfig({
  base: Bun.env.VITE_BASE ?? '/',
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
    },
  },
})
