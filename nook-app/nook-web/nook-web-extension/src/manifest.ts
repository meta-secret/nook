import {
  defaultSimpleVaultBaseUrl,
  nookVaultAppExcludeMatchPatterns,
  sentinelVaultMatchPatterns,
  simpleVaultMatchPattern,
} from './lib/simple-vault-target'

enum ManifestIconSize {
  Small = '16',
  Medium = '32',
  Large = '48',
  Store = '128',
}

type ManifestIconSet = Record<ManifestIconSize, string>

export enum ExtensionManifestType {
  Module = 'module',
}

enum ContentScriptRunAt {
  DocumentIdle = 'document_idle',
  DocumentStart = 'document_start',
}

enum ContentScriptWorld {
  Isolated = 'ISOLATED',
  Main = 'MAIN',
}

enum ExtensionPermission {
  ActiveTab = 'activeTab',
  Offscreen = 'offscreen',
  Storage = 'storage',
}

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
    type: ExtensionManifestType.Module
  }
  content_security_policy: {
    extension_pages: string
  }
  content_scripts: Array<{
    matches: string[]
    exclude_matches: string[]
    js: string[]
    run_at: ContentScriptRunAt
    type?: ExtensionManifestType.Module
    world?: ContentScriptWorld
  }>
  externally_connectable: {
    matches: string[]
  }
  icons: ManifestIconSet
  permissions: ExtensionPermission[]
  host_permissions: string[]
  web_accessible_resources: Array<{
    resources: string[]
    matches: string[]
  }>
}

const iconSet: ManifestIconSet = {
  [ManifestIconSize.Small]: 'icons/nook.png',
  [ManifestIconSize.Medium]: 'icons/nook.png',
  [ManifestIconSize.Large]: 'icons/nook.png',
  [ManifestIconSize.Store]: 'icons/nook.png',
}

export function createManifest(
  version: string,
  simpleVaultBaseUrl = defaultSimpleVaultBaseUrl(),
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
      type: ExtensionManifestType.Module,
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
        // Companion-ready uses top-level await; classic content scripts reject TLA.
        type: ExtensionManifestType.Module,
        run_at: ContentScriptRunAt.DocumentIdle,
      },
      {
        matches: ['<all_urls>'],
        exclude_matches: vaultAppExclusions,
        js: ['content/webauthn-content.js'],
        run_at: ContentScriptRunAt.DocumentStart,
        world: ContentScriptWorld.Isolated,
      },
      {
        matches: ['<all_urls>'],
        exclude_matches: vaultAppExclusions,
        js: ['content/webauthn-page.js'],
        run_at: ContentScriptRunAt.DocumentStart,
        world: ContentScriptWorld.Main,
      },
      {
        matches: [simpleVaultMatch],
        exclude_matches: sentinelVaultMatchPatterns(simpleVaultBaseUrl),
        js: ['content/simple-vault-bridge.js'],
        run_at: ContentScriptRunAt.DocumentStart,
      },
    ],
    externally_connectable: {
      matches: [simpleVaultMatch],
    },
    icons: iconSet,
    permissions: [
      ExtensionPermission.ActiveTab,
      ExtensionPermission.Offscreen,
      ExtensionPermission.Storage,
    ],
    host_permissions: ['<all_urls>'],
    web_accessible_resources: [
      {
        resources: [
          'icons/nook.png',
          // Content scripts fetch companion WASM via chrome.runtime.getURL;
          // MV3 requires the package path to be web-accessible for page worlds.
          'content/nook_companion_wasm_bg.wasm',
        ],
        matches: ['<all_urls>'],
      },
    ],
  }
}
