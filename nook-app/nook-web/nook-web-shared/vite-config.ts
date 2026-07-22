import { copyFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vitest/config";
import { vaultAppHeaders } from "./src/vault-app/security-headers";

type VaultSpaOptions = {
  name: string;
  spaPaths: string[];
  denyPath?: (pathname: string) => boolean;
  outputAliases: string[];
};

export function vaultSpaPlugin(options: VaultSpaOptions): Plugin {
  const spaPaths = new Set(options.spaPaths);
  const middleware: NonNullable<Plugin["configureServer"]> = (server) => {
    server.middlewares.use((request, response, next) => {
      const pathname =
        request.url?.split(/[?#]/, 1)[0]?.replace(/\/$/, "") || "/";
      if (options.denyPath?.(pathname)) {
        response.statusCode = 404;
        response.end("Not Found");
        return;
      }
      if (spaPaths.has(pathname)) request.url = "/index.html";
      next();
    });
  };
  return {
    name: options.name,
    configureServer: middleware,
    configurePreviewServer: middleware,
    writeBundle() {
      const outDir = join(process.cwd(), "dist");
      const shell = join(outDir, "index.html");
      copyFileSync(shell, join(outDir, "404.html"));
      for (const alias of options.outputAliases) {
        copyFileSync(shell, join(outDir, `${alias}.html`));
      }
      writeFileSync(join(outDir, "_headers"), vaultAppHeaders());
      writeFileSync(join(outDir, "robots.txt"), "User-agent: *\nDisallow: /\n");
    },
  };
}

export function vaultAppAliases(wasmApplicationPath: string) {
  return {
    $lib: new URL("./src/vault-app/lib", import.meta.url).pathname,
    "$vault-shared": new URL("./src/vault-app", import.meta.url).pathname,
    "$web-shared": new URL("./src", import.meta.url).pathname,
    "$app-wasm": wasmApplicationPath,
  };
}
