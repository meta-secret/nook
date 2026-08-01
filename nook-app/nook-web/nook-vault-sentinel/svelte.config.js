import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/vite-plugin-svelte').SvelteConfig} */
const config = {
  preprocess: vitePreprocess({ script: true }),
};

export default config;
