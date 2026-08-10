export const typedApiSourceFiles = [
  "nook-web-extension/src/**/*.{ts,svelte}",
  "nook-web-shared/src/**/*.{ts,svelte}",
  "nook-web-app/src/**/*.{ts,svelte}",
  "nook-web-research/src/**/*.{ts,svelte}",
  "nook-vault-{simple,sentinel}/**/*.{ts,svelte}",
];

export const untrustedInputAdapterFiles = [
  "nook-web-app/src/landing/github-stars-state.ts",
  "nook-web-extension/src/chrome.d.ts",
  "nook-web-extension/src/content/simple-vault-bridge.ts",
  "nook-web-extension/src/content/webauthn-content.ts",
  "nook-web-extension/src/content/webauthn-page.ts",
  // Rust/WASM and Chrome persistence boundaries narrow serialized state.
  "nook-web-extension/src/background/pairing-grants.ts",
  "nook-web-extension/src/background/vault-runtime.ts",
  // Chrome service-worker request and response boundary adapters.
  "nook-web-extension/src/background/service-worker/account-pickers.ts",
  "nook-web-extension/src/background/service-worker/authenticator-session-adapter.ts",
  "nook-web-extension/src/background/service-worker/login-session-response-adapter.ts",
  "nook-web-extension/src/background/service-worker/pairing-identity.ts",
  "nook-web-extension/src/background/service-worker/passkey-session-adapter.ts",
  "nook-web-extension/src/background/service-worker/session-lifecycle.ts",
  "nook-web-extension/src/content/autofill/login-passkey-actions.ts",
  "nook-web-extension/src/content/autofill/login-fill-runtime-adapter.ts",
  "nook-web-extension/src/content/enrollment-flow.ts",
  "nook-web-extension/src/content/enrollment-outcome.ts",
  "nook-web-extension/src/offscreen/session-request-adapter.ts",
  "nook-web-extension/src/offscreen/session-key-material.ts",
  "nook-web-extension/src/offscreen/session.ts",
  // Popup code immediately narrows Chrome runtime responses into view models.
  "nook-web-extension/src/popup/AuthenticatorPicker.svelte",
  "nook-web-extension/src/popup/LoginPicker.svelte",
  "nook-web-extension/src/popup/PopupApp.svelte",
  // WebAssembly initialization is the sole shared generic module boundary.
  "nook-web-shared/src/extension/companion-ready.ts",
  "nook-web-shared/src/extension/extension-connect-scope.ts",
  "nook-web-shared/src/extension/runtime-messages.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/auth-errors.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/cloudkit-runtime.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/web-auth-wait.ts",
  "nook-web-shared/src/vault-app/lib/auth/google/oauth.ts",
  "nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts",
  "nook-web-shared/src/vault-app/lib/extension/connect.ts",
  "nook-web-shared/src/vault-app/lib/extension/install.ts",
];

export const typedApiRules = {
  "max-params": ["error", { max: 1 }],
  "@typescript-eslint/no-restricted-types": [
    "error",
    {
      types: {
        unknown: {
          message:
            "Nook web forbids unknown. Model a concrete domain type. A generic transport value is allowed only inside a dedicated untrusted-input adapter and must be narrowed immediately.",
        },
        ExternalValue: { message: "Use a concrete Nook domain value." },
        ExternalObject: { message: "Use a concrete Nook domain object." },
        JsonValue: { message: "Use a concrete Nook domain value." },
        GenericValue: { message: "Use a concrete Nook domain value." },
      },
    },
  ],
  "nook-typed-api/no-raw-object-arguments": "error",
};

export const untrustedInputAdapterRules = {
  "@typescript-eslint/no-restricted-types": [
    "error",
    {
      types: {
        ExternalValue: { message: "Use a concrete Nook domain value." },
        ExternalObject: { message: "Use a concrete Nook domain object." },
        JsonValue: { message: "Use a concrete Nook domain value." },
        GenericValue: { message: "Use a concrete Nook domain value." },
      },
    },
  ],
};
