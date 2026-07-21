import { svelte } from '@sveltejs/vite-plugin-svelte'
import { defineConfig } from 'vite'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(fileURLToPath(import.meta.url))
const wasmDir = path.resolve(
  root,
  '../../../nook-web-shared/src/vault-app/lib/nook-wasm',
)

export default defineConfig({
  root,
  plugins: [svelte()],
  resolve: {
    alias: {
      'nook-wasm': path.join(wasmDir, 'nook_wasm.js'),
    },
  },
  optimizeDeps: {
    exclude: ['nook-wasm'],
  },
  assetsInclude: ['**/*.wasm'],
  build: {
    outDir: path.join(root, 'dist'),
    emptyOutDir: true,
    target: 'esnext',
  },
})
