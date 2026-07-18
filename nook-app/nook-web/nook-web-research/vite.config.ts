import { svelte } from '@sveltejs/vite-plugin-svelte'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: new URL('./src/lib', import.meta.url).pathname,
      '$vault-shared': new URL(
        '../nook-web-shared/src/vault-app',
        import.meta.url,
      ).pathname,
    },
  },
  server: { fs: { allow: ['..'] } },
})
