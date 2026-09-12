globalThis.fetch = Object.assign(
  async (..._args: Parameters<typeof fetch>) => {
    void _args
    throw new Error('unexpected companion WASM fetch')
  },
  { preconnect: fetch.preconnect },
)

const { companionWasmReady } =
  await import('../../nook-web-shared/src/extension/companion-ready')
const { ExtensionConnectScope } =
  await import('../../nook-web-shared/src/extension/extension-connect-scope')
await companionWasmReady

const scopeValues = [
  ExtensionConnectScope.VaultAccess,
  ExtensionConnectScope.PasswordFilling,
  ExtensionConnectScope.PasskeyManagement,
  ExtensionConnectScope.SyncProviderCredentials,
]
if (
  !scopeValues.every((value) =>
    ExtensionConnectScope.isExtensionConnectScopeValue(value),
  )
) {
  throw new Error('companion scope runtime was not configured')
}
console.log(JSON.stringify(scopeValues))
