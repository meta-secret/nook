type ManifestIconSet = Record<'16' | '32' | '48' | '128', string>

export type ExtensionManifest = {
  manifest_version: 3
  name: string
  short_name: string
  description: string
  version: string
  action: {
    default_title: string
    default_popup: string
    default_icon: ManifestIconSet
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
    run_at: 'document_idle'
  }>
  externally_connectable: {
    matches: string[]
  }
  icons: ManifestIconSet
  permissions: Array<'activeTab' | 'storage'>
  host_permissions: string[]
}

const iconSet: ManifestIconSet = {
  '16': 'icons/nook.png',
  '32': 'icons/nook.png',
  '48': 'icons/nook.png',
  '128': 'icons/nook.png',
}

export function createManifest(version: string): ExtensionManifest {
  return {
    manifest_version: 3,
    name: 'Nook Passwords',
    short_name: 'Nook',
    description:
      'Nook browser companion for password form detection and future autofill.',
    version,
    action: {
      default_title: 'Nook',
      default_popup: 'popup/index.html',
      default_icon: iconSet,
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
        exclude_matches: ['https://sentinel.nokey.sh/*'],
        js: ['content/autofill.js'],
        run_at: 'document_idle',
      },
    ],
    externally_connectable: {
      matches: ['https://simple.nokey.sh/*'],
    },
    icons: iconSet,
    permissions: ['activeTab', 'storage'],
    host_permissions: ['<all_urls>'],
  }
}
