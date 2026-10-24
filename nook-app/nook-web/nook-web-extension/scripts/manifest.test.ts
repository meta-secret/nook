import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'

await companionWasmReady
import { describe, expect, test } from 'bun:test'
import {
  createManifest,
  ContentScriptRunAt,
  type CreateExtensionManifestArgs,
  ExtensionManifestBuildKind,
  ExtensionPermission,
  type ExtensionManifestDeployment,
} from '../src/manifest'
import { SIDE_PANEL_PAGE_PATH } from '../src/lib/side-panel-page-path'

const defaultManifestArgs: CreateExtensionManifestArgs = {
  kind: ExtensionManifestBuildKind.StoreRelease,
  version: '1.0.0',
}

const testDeployment: ExtensionManifestDeployment = {
  key: 'test-key',
  name: 'Nook Passwords Preview',
  shortName: 'Nook Preview',
  versionName: '1.0.0 (preview)',
}

function defaultManifest() {
  return createManifest(defaultManifestArgs)
}

const environments = [
  {
    simple: 'https://simple.nokey.sh/',
    sentinel: 'https://sentinel.nokey.sh/*',
  },
  {
    simple: 'https://simple.dev.nokey.sh/',
    sentinel: 'https://sentinel.dev.nokey.sh/*',
  },
  {
    simple: 'https://pr-408.nokey-simple.pages.dev/',
    sentinel: 'https://pr-408.nokey-sentinel.pages.dev/*',
  },
] as const

const sidePanelPagePath = SIDE_PANEL_PAGE_PATH

function channelManifest() {
  const manifestArgs: CreateExtensionManifestArgs = {
    kind: ExtensionManifestBuildKind.Channel,
    version: '1.0.0',
    simpleVaultBaseUrl: 'https://pr-408.nokey-simple.pages.dev/',
    deployment: testDeployment,
  }
  return createManifest(manifestArgs)
}

describe('toolbar side panel', () => {
  test('the toolbar button opens the side panel and declares no popup', () => {
    for (const manifest of [defaultManifest(), channelManifest()]) {
      expect(Object.keys(manifest.action)).toEqual([
        'default_title',
        'default_icon',
      ])
      expect('default_popup' in manifest.action).toBe(false)
      expect(manifest.side_panel).toEqual({ default_path: sidePanelPagePath })
    }
  })

  test('adds only the side panel permission', () => {
    for (const manifest of [defaultManifest(), channelManifest()]) {
      expect(manifest.permissions).toEqual([
        ExtensionPermission.ActiveTab,
        ExtensionPermission.Offscreen,
        ExtensionPermission.Storage,
        ExtensionPermission.SidePanel,
      ])
      expect(manifest.host_permissions).toEqual(['<all_urls>'])
    }
  })

  test('keeps the extension page policy and keeps the panel off the web', () => {
    for (const manifest of [defaultManifest(), channelManifest()]) {
      expect(manifest.content_security_policy).toEqual({
        extension_pages:
          "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
      })
      const exposed = manifest.web_accessible_resources.flatMap(
        ({ resources }) => resources,
      )
      expect(exposed).not.toContain(sidePanelPagePath)
      expect(
        exposed.some((resource) => resource.startsWith('side-panel/')),
      ).toBe(false)
    }
  })
})

describe('extension origin isolation', () => {
  for (const environment of environments) {
    test(`connects only to ${environment.simple}`, () => {
      const manifestArgs: CreateExtensionManifestArgs = {
        kind: ExtensionManifestBuildKind.Channel,
        version: '1.0.0',
        simpleVaultBaseUrl: environment.simple,
        deployment: testDeployment,
      }
      const manifest = createManifest(manifestArgs)
      const simpleMatch = `${environment.simple}*`

      expect(manifest.externally_connectable.matches).toEqual([simpleMatch])
      expect(manifest.externally_connectable.matches).not.toContain(
        environment.sentinel,
      )
      expect(
        manifest.content_scripts.every(({ exclude_matches }) =>
          exclude_matches.includes(environment.sentinel),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.some(({ matches }) =>
          matches.includes(environment.sentinel),
        ),
      ).toBe(false)
      const broadScripts = manifest.content_scripts.filter(({ matches }) =>
        matches.includes('<all_urls>'),
      )
      expect(broadScripts.length).toBeGreaterThan(0)
      expect(
        broadScripts.every(({ exclude_matches }) =>
          exclude_matches.includes(simpleMatch),
        ),
      ).toBe(true)
      expect(
        broadScripts.every(
          ({ exclude_matches }) =>
            exclude_matches.includes('https://simple.nokey.sh/*') &&
            exclude_matches.includes('https://simple.dev.nokey.sh/*') &&
            exclude_matches.includes('https://*.nokey-simple.pages.dev/*') &&
            exclude_matches.includes('https://*.nokey-sentinel.pages.dev/*'),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.some(
          ({ matches, exclude_matches }) =>
            matches.includes(simpleMatch) &&
            !exclude_matches.includes(simpleMatch),
        ),
      ).toBe(true)
      expect(
        manifest.content_scripts.find(({ matches }) =>
          matches.includes(simpleMatch),
        )?.run_at,
      ).toBe(ContentScriptRunAt.DocumentStart)
    })
  }

  test('declares offscreen and storage permissions for its memory-only session coordination', () => {
    expect(defaultManifest().permissions).toContain(
      ExtensionPermission.Offscreen,
    )
    expect(defaultManifest().permissions).toContain(ExtensionPermission.Storage)
  })

  test('requires the browser version that can close the side panel', () => {
    expect(defaultManifest().min_chrome_version).toBe('141')
  })

  test('exposes the icon, host, and companion WASM to in-page content scripts', () => {
    expect(defaultManifest().web_accessible_resources).toEqual([
      {
        resources: [
          'icons/nook.png',
          'login-picker/index.html',
          'login-picker/assets/*',
          'personal-picker/index.html',
          'personal-picker/assets/*',
          'content/companion-wasm-host.html',
          'content/companion-wasm-host.js',
          'content/nook_companion_wasm_bg.wasm',
        ],
        matches: ['<all_urls>'],
      },
    ])
  })

  test('loads autofill as a classic script with promise-based WASM readiness', () => {
    const autofill = defaultManifest().content_scripts.find((script) =>
      script.js.includes('content/autofill.js'),
    )
    if (!autofill) throw new Error('Autofill content script is not declared.')
    expect('type' in autofill).toBe(false)
    expect(autofill).toHaveProperty('all_frames', true)
    expect(
      defaultManifest()
        .content_scripts.filter(
          (script) => !script.js.includes('content/autofill.js'),
        )
        .every((script) => !script.all_frames),
    ).toBe(true)
  })

  test('keeps autofill enabled on the Namecheap login origin', () => {
    const autofill = defaultManifest().content_scripts.find((script) =>
      script.js.includes('content/autofill.js'),
    )
    if (!autofill) throw new Error('Autofill content script is not declared.')

    expect(autofill.matches).toContain('<all_urls>')
    expect(autofill.exclude_matches).not.toContain(
      'https://www.namecheap.com/*',
    )
    expect(autofill.exclude_matches).not.toContain('https://namecheap.com/*')
  })

  test('installs a MAIN-world authentication route hook at document start', () => {
    const scripts = defaultManifest().content_scripts
    expect(
      scripts.some(
        (script) =>
          script.world === 'MAIN' &&
          script.run_at === 'document_start' &&
          script.js.includes('content/authentication-route-page.js'),
      ),
    ).toBe(true)
  })

  test('installs isolated transport and page-world WebAuthn bridges at document start', () => {
    const scripts = defaultManifest().content_scripts
    expect(
      scripts.some(
        (script) =>
          script.world === 'ISOLATED' &&
          script.run_at === 'document_start' &&
          script.js.includes('content/webauthn-content.js'),
      ),
    ).toBe(true)
    expect(
      scripts.some(
        (script) =>
          script.world === 'MAIN' &&
          script.run_at === 'document_start' &&
          script.js.includes('content/webauthn-page.js'),
      ),
    ).toBe(true)
  })
})
