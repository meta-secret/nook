import type { KnipConfig } from "knip";

// Knip 6 runs from nook-web: it analyzes only files under its root, and every
// surface shares components from nook-web-shared.

const scriptBlock =
  /<script(?=[\s/>])(?:[^>"']|"[^"]*"|'[^']*')*>([\s\S]*?)<\/script>/gi;
const styleBlock =
  /<style(?![\w-])(?:[^>"']|"[^"]*"|'[^']*')*>[\s\S]*?<\/style>/gi;
const htmlComment = /<!--[\s\S]*?-->/g;
const memberAccess = /(?<![\w$.])[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+/g;

/** Knip's own Svelte compiler keeps only import lines, so member uses such as
 * `LogoSize.Small` or `<Select.Root>` are invisible to it. This passes the
 * whole script bodies, plus each `Name.member` written in the markup. */
const svelte = (text: string): string => {
  const scripts = [...text.matchAll(scriptBlock)].map((match) => match[1]);
  const markup = text
    .replace(scriptBlock, "")
    .replace(styleBlock, "")
    .replace(htmlComment, "");
  const accesses = [...markup.matchAll(memberAccess)].map(
    (match) => `${match[0]};`,
  );
  return [...scripts, ...accesses].join("\n");
};

const config: KnipConfig = {
  include: ["files", "exports", "types", "enumMembers", "namespaceMembers"],
  includeEntryExports: true,
  ignoreExportsUsedInFile: true,
  paths: {
    $lib: ["nook-web-shared/src/vault-app/lib"],
    "$lib/*": ["nook-web-shared/src/vault-app/lib/*"],
    "$vault-shared": ["nook-web-shared/src/vault-app"],
    "$vault-shared/*": ["nook-web-shared/src/vault-app/*"],
    "$web-shared/*": ["nook-web-shared/src/*"],
    "$app-wasm": ["nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm"],
  },
  vite: {
    config: [
      "nook-web-app/vite.config.ts",
      "nook-vault-simple/vite.config.ts",
      "nook-vault-sentinel/vite.config.ts",
      "nook-web-extension/e2e/mock-auth/vite.config.ts",
    ],
  },
  vitest: {
    config: ["nook-web-app/vite.config.ts"],
  },
  playwright: {
    config: [
      "nook-web-app/playwright*.config.ts",
      "nook-web-extension/playwright*.config.ts",
    ],
  },
  entry: [
    "nook-web-app/src/main.ts",
    "nook-web-app/scripts/**/*.ts",
    "nook-web-app/tests/**/*.{test,spec}.ts",
    "nook-web-app/tests/unit/setup-wasm.ts",
    "nook-web-app/e2e/**/*.spec.ts",
    "nook-web-app/e2e/cleanup-github-repos.ts",
    "nook-web-shared/src/vault-app/App.svelte",
    "nook-vault-{simple,sentinel}/src/main.ts",
    "nook-vault-sentinel/src/ExtensionConnectDisabled.svelte",
    "nook-vault-sentinel/src/ExtensionRequestPanelDisabled.svelte",
    "nook-vault-sentinel/src/extension-connect-disabled.ts",
    "nook-vault-sentinel/src/extension-connect-progress-disabled.ts",
    "nook-vault-sentinel/src/extension-connect-progress-steps-disabled.ts",
    "nook-web-extension/scripts/{build,deployment-package,dev-loop}.ts",
    "nook-web-extension/scripts/**/*.test.ts",
    "nook-web-extension/e2e/**/*.spec.ts",
    "nook-web-extension/e2e/mock-auth/src/**/*.test.ts",
    "nook-web-extension/e2e/mock-auth/src/main.ts",
    "nook-web-extension/e2e/mock-auth/src/App.svelte",
    "nook-web-extension/src/background/service-worker.ts",
    "nook-web-extension/src/content/{authentication-route-page,autofill,companion-wasm-host,simple-vault-bridge,webauthn-content,webauthn-page}.ts",
    "nook-web-extension/src/offscreen/session.ts",
    "nook-web-extension/src/login-picker/main.ts",
    "nook-web-extension/src/personal-picker/main.ts",
    "nook-web-extension/src/popup/main.ts",
    "nook-web-extension/src/side-panel/main.ts",
    "nook-web-extension/e2e/mock-auth/build.ts",
  ],
  project: [
    "nook-web-app/src/main.ts",
    "nook-web-app/vite.config.ts",
    "nook-web-app/scripts/**/*.ts",
    "nook-web-app/tests/**/*.ts",
    "nook-web-app/e2e/**/*.ts",
    "nook-web-app/playwright*.config.ts",
    "nook-web-shared/src/**/*.{ts,svelte}",
    "!nook-web-shared/src/vault-app/lib/nook-wasm*/**",
    "!nook-web-shared/src/extension/nook-companion-wasm*/**",
    "!nook-web-shared/src/extension/**/*.d.ts",
    "nook-vault-{simple,sentinel}/src/**/*.{ts,svelte}",
    "nook-vault-{simple,sentinel}/vite.config.ts",
    "nook-web-extension/scripts/**/*.ts",
    "nook-web-extension/e2e/**/*.ts",
    "nook-web-extension/e2e/mock-auth/src/**/*.{ts,svelte}",
    "!nook-web-extension/e2e/mock-auth/src/**/*.d.ts",
    "nook-web-extension/src/**/*.{ts,svelte}",
    "!nook-web-extension/src/**/*.d.ts",
  ],
  compilers: { svelte },
};

export default config;
