export const typedApiSourceFiles = [
  "nook-web-extension/src/**/*.{ts,svelte}",
  "nook-web-shared/src/**/*.{ts,svelte}",
  "nook-web-app/src/**/*.{ts,svelte}",
  "nook-web-research/src/**/*.{ts,svelte}",
  "nook-vault-{simple,sentinel}/**/*.{ts,svelte}",
];

export const untrustedInputAdapterFiles = [
  "nook-web-app/src/landing/github-stars-state.ts",
  "nook-web-app/src/landing/structured-data.ts",
  "nook-web-extension/src/chrome.d.ts",
  "nook-web-extension/src/content/simple-vault-bridge.ts",
  "nook-web-extension/src/content/webauthn-content.ts",
  "nook-web-extension/src/content/webauthn-page.ts",
  // Chrome runtime message guards narrow untyped browser IPC immediately.
  "nook-web-extension/src/lib/auth-workflow-messages.ts",
  "nook-web-extension/src/lib/browser-runtime-message.ts",
  "nook-web-extension/src/lib/authenticator-picker-messages.ts",
  "nook-web-extension/src/lib/enrollment-messages.ts",
  "nook-web-extension/src/lib/login-detection-messages.ts",
  "nook-web-extension/src/lib/login-fill-messages.ts",
  "nook-web-extension/src/lib/login-picker-messages.ts",
  "nook-web-extension/src/lib/login-save-messages.ts",
  "nook-web-extension/src/lib/origin-runtime-message.ts",
  "nook-web-extension/src/lib/outcome-evidence-messages.ts",
  "nook-web-extension/src/lib/pairing-state.ts",
  "nook-web-extension/src/lib/passkey-ceremony-error.ts",
  "nook-web-extension/src/lib/provider-credential-staging.ts",
  "nook-web-extension/src/lib/serialized-wire-value-adapter.ts",
  "nook-web-extension/src/lib/webauthn-messages.ts",
  // Rust/WASM and Chrome persistence boundaries narrow serialized state.
  "nook-web-extension/src/background/pairing-grants.ts",
  "nook-web-extension/src/background/vault-runtime.ts",
  // Chrome service-worker request and response boundary adapters.
  "nook-web-extension/src/background/service-worker.ts",
  "nook-web-extension/src/background/service-worker/account-pickers.ts",
  "nook-web-extension/src/background/service-worker/authenticator-session-adapter.ts",
  "nook-web-extension/src/background/service-worker/login-session-response-adapter.ts",
  "nook-web-extension/src/background/service-worker/pairing-identity.ts",
  "nook-web-extension/src/background/service-worker/pairing-import.ts",
  "nook-web-extension/src/background/service-worker/passkey-session-adapter.ts",
  "nook-web-extension/src/background/service-worker/session-lifecycle.ts",
  "nook-web-extension/src/content/autofill/runtime-message-adapter.ts",
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
  // Chrome runtime replies enter the Rust decoders as singular unknown values.
  "nook-web-extension/src/lib/nook-wasm.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/auth-errors.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/cloudkit-runtime.ts",
  "nook-web-shared/src/vault-app/lib/auth/icloud/web-auth-wait.ts",
  "nook-web-shared/src/vault-app/lib/auth/google/oauth.ts",
  "nook-web-shared/src/vault-app/lib/auth/passkey-device-protection.ts",
  "nook-web-shared/src/vault-app/lib/extension/connect.ts",
  "nook-web-shared/src/vault-app/lib/extension/install.ts",
];

export const concreteObjectTypeRules = {
  "@typescript-eslint/no-restricted-types": [
    "error",
    {
      types: {
        object: {
          message:
            "Nook web forbids the generic object type. Model a concrete domain value or discriminated union.",
        },
        Object: {
          message:
            "Nook web forbids the Object type. Model a concrete domain value or discriminated union.",
        },
        "{}": {
          message:
            "Nook web forbids the empty object type. Model every valid branch explicitly.",
        },
      },
    },
  ],
  "@typescript-eslint/no-explicit-any": "error",
  "@typescript-eslint/no-empty-object-type": "error",
};

const typePredicateRestriction = {
  selector: "TSTypePredicate",
  message:
    "Nook web forbids TypeScript type predicates. Return a named decoder outcome or use a concrete-value API.",
};

export const typedApiRules = {
  "no-restricted-syntax": ["error", typePredicateRestriction],
  "max-params": ["error", { max: 1 }],
  "@typescript-eslint/no-restricted-types": [
    "error",
    {
      types: {
        unknown: {
          message:
            "Nook web forbids unknown. Model a concrete domain type. A generic transport value is allowed only inside a dedicated untrusted-input adapter and must be narrowed immediately.",
        },
        object: {
          message:
            "Nook web forbids the generic object type. Model a concrete domain value or discriminated union.",
        },
        Object: {
          message:
            "Nook web forbids the Object type. Model a concrete domain value or discriminated union.",
        },
        "{}": {
          message:
            "Nook web forbids the empty object type. Model every valid branch explicitly.",
        },
        ExternalValue: { message: "Use a concrete Nook domain value." },
        ExternalObject: { message: "Use a concrete Nook domain object." },
        JsonValue: { message: "Use a concrete Nook domain value." },
        GenericValue: { message: "Use a concrete Nook domain value." },
      },
    },
  ],
  "nook-typed-api/no-raw-object-arguments": [
    "error",
    { enforceNamedParameterContracts: true },
  ],
  "nook-typed-api/no-empty-success-contract": "error",
};

export const untrustedInputAdapterRules = {
  // Keep a singular unknown available at the immediate browser/JSON decoder,
  // but do not let an untyped value escape inside a collection or composite
  // contract. These selectors use TypeScript ESTree nodes (not source-text
  // matching) so nested generic and structural payloads are covered too.
  "no-restricted-syntax": [
    "error",
    typePredicateRestriction,
    {
      selector: "TSArrayType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in arrays at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSTupleType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in tuples at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSTypeParameterInstantiation:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in generic arguments at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSUnionType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in unions at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSIntersectionType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in intersections at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSPropertySignature > TSTypeAnnotation > TSUnknownKeyword",
      message:
        "Nook web forbids unknown properties in transport contracts. Decode each value into a concrete type.",
    },
    {
      selector: "TSIndexSignature > TSTypeAnnotation > TSUnknownKeyword",
      message:
        "Nook web forbids unknown index-signature values at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSConditionalType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in conditional types at transport boundaries. Decode each value into a concrete type.",
    },
    {
      selector: "TSMappedType:has(TSUnknownKeyword)",
      message:
        "Nook web forbids unknown in mapped types at transport boundaries. Decode each value into a concrete type.",
    },
  ],
  "@typescript-eslint/no-restricted-types": [
    "error",
    {
      types: {
        object: {
          message:
            "Nook web forbids the generic object type, including at transport boundaries. Use unknown only while decoding unavoidable untyped input.",
        },
        Object: {
          message:
            "Nook web forbids the Object type, including at transport boundaries.",
        },
        "{}": {
          message:
            "Nook web forbids the empty object type. Model every valid branch explicitly.",
        },
        ExternalValue: { message: "Use a concrete Nook domain value." },
        ExternalObject: { message: "Use a concrete Nook domain object." },
        JsonValue: { message: "Use a concrete Nook domain value." },
        GenericValue: { message: "Use a concrete Nook domain value." },
      },
    },
  ],
};
