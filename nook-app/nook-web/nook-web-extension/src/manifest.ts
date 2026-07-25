import {
  DEFAULT_SIMPLE_VAULT_URL,
  nookVaultAppExcludeMatchPatterns,
  sentinelVaultMatchPatterns,
  simpleVaultMatchPattern,
} from './lib/simple-vault-target'

type ManifestIconSet = Record<'16' | '32' | '48' | '128', string>

export type ExtensionManifest = {
  manifest_version: 3
  default_locale: 'en'
  name: string
  short_name: string
  description: string
  version: string
  version_name?: string
  key?: string
  action: {
    default_title: string
    default_icon: ManifestIconSet
    default_popup: 'popup/index.html'
  }
  background: {
    service_worker: string
    type: 'module'
  }
  content_security_policy: {
    extension_pages: string
  }
  content_scripts: Array<{
    matches: string[]
    exclude_matches: string[]
    js: string[]
    run_at: 'document_idle' | 'document_start'
    world?: 'ISOLATED' | 'MAIN'
  }>
  externally_connectable: {
    matches: string[]
  }
  icons: ManifestIconSet
  permissions: Array<'activeTab' | 'offscreen' | 'storage'>
  host_permissions: string[]
  web_accessible_resources: Array<{
    resources: string[]
    matches: string[]
  }>
}

const iconSet: ManifestIconSet = {
  '16': 'icons/nook.png',
  '32': 'icons/nook.png',
  '48': 'icons/nook.png',
  '128': 'icons/nook.png',
}

export function createManifest(
  version: string,
  simpleVaultBaseUrl = DEFAULT_SIMPLE_VAULT_URL,
  deployment?: {
    key: string
    name: string
    shortName: string
    versionName: string
  },
): ExtensionManifest {
  const simpleVaultMatch = simpleVaultMatchPattern(simpleVaultBaseUrl)
  const vaultAppExclusions =
    nookVaultAppExcludeMatchPatterns(simpleVaultBaseUrl)
  return {
    manifest_version: 3,
    default_locale: 'en',
    name: deployment?.name ?? 'Nook Passwords',
    short_name: deployment?.shortName ?? 'Nook',
    description:
      'Nook browser companion for password form detection and future autofill.',
    version,
    ...(deployment
      ? { key: deployment.key, version_name: deployment.versionName }
      : {}),
    action: {
      default_title: 'Nook',
      default_icon: iconSet,
      default_popup: 'popup/index.html',
    },
    background: {
      service_worker: 'background/service-worker.js',
      type: 'module',
    },
    content_security_policy: {
      extension_pages:
        "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
    content_scripts: [
      {
        matches: ['<all_urls>'],
        exclude_matches: vaultAppExclusions,
        js: ['content/autofill.js'],
        run_at: 'document_idle',
      },
      {
        matches: ['<all_urls>'],
        exclude_matches: vaultAppExclusions,
        js: ['content/webauthn-content.js'],
        run_at: 'document_start',
        world: 'ISOLATED',
      },
      {
        matches: ['<all_urls>'],
        exclude_matches: vaultAppExclusions,
        js: ['content/webauthn-page.js'],
        run_at: 'document_start',
        world: 'MAIN',
      },
      {
        matches: [simpleVaultMatch],
        exclude_matches: sentinelVaultMatchPatterns(simpleVaultBaseUrl),
        js: ['content/simple-vault-bridge.js'],
        run_at: 'document_start',
      },
    ],
    externally_connectable: {
      matches: [simpleVaultMatch],
    },
    icons: iconSet,
    permissions: ['activeTab', 'offscreen', 'storage'],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: ['icons/nook.png'],
        matches: ['<all_urls>'],
      },
    ],
  }
}
